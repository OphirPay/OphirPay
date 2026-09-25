// SPDX-License-Identifier: MIT
/*
OphirPay webhook signature verification - reference implementation (Go)

Canonicalization (must match `buildSignedPayload` in
`src/lib/webhook-deliver.ts`):

  1. Parse the received JSON body as an object.
  2. Set the `signature` field to "" - keep the key, empty the value.
     (Do NOT delete the key; the canonical string contains `"signature":""`.)
  3. Re-serialize with stable key order matching the sender's insertion order.
     Use compact formatting (no whitespace outside of strings) and raw UTF-8
     so the bytes match Node's `JSON.stringify`.
  4. Compute HMAC-SHA256 (hex) over that canonical string using your
     webhook secret.
  5. Compare against the `X-OphirPay-Signature` header with a
     constant-time comparison (`hmac.Equal`).

CLI:

  go run verify.go --secret <secret> --signature <hex> \
      [--body-file <path>] [--max-age <seconds>] [--now <iso>]

Reads the body from `--body-file`, or stdin when omitted. Prints "VALID"
and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.
*/

package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
	"time"
)

const defaultMaxAgeSeconds = 300 // replay-protection window

type keyVal struct {
	key string
	val []byte
}

// canonicalize builds the canonical string a receiver must sign, byte-for-byte
// identical to what buildSignedPayload signs on the sender side.
func canonicalize(body []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, errors.New("body must be a JSON object")
	}

	dec := json.NewDecoder(bytes.NewReader(trimmed))
	t, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("body must be a JSON object: %w", err)
	}
	delim, ok := t.(json.Delim)
	if !ok || delim != '{' {
		return nil, errors.New("body must be a JSON object")
	}

	var pairs []keyVal
	hasSig := false

	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("invalid body: %w", err)
		}
		key, ok := tok.(string)
		if !ok {
			return nil, errors.New("invalid JSON key")
		}

		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, fmt.Errorf("invalid body: %w", err)
		}

		if key == "signature" {
			hasSig = true
			pairs = append(pairs, keyVal{key: key, val: []byte(`""`)})
		} else {
			// Compact the raw JSON value so that nested objects/arrays
			// contain no insignificant whitespace, matching JSON.stringify.
			var compacted bytes.Buffer
			if err := json.Compact(&compacted, raw); err != nil {
				return nil, fmt.Errorf("invalid body: %w", err)
			}
			pairs = append(pairs, keyVal{key: key, val: compacted.Bytes()})
		}
	}

	// Read closing '}'
	if _, err := dec.Token(); err != nil {
		return nil, fmt.Errorf("invalid body: %w", err)
	}

	// Empty the signature field instead of deleting it: the HMAC input
	// includes `"signature":""`. If missing, append it as the last key.
	if !hasSig {
		pairs = append(pairs, keyVal{key: "signature", val: []byte(`""`)})
	}

	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, p := range pairs {
		if i > 0 {
			buf.WriteByte(',')
		}
		keyEscaped, _ := json.Marshal(p.key)
		buf.Write(keyEscaped)
		buf.WriteByte(':')
		buf.Write(p.val)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// verifyWebhookSignature verifies an OphirPay webhook delivery.
// Returns (valid bool, reason string).
func verifyWebhookSignature(body []byte, signature, secret string, maxAgeSeconds int, now time.Time) (bool, string) {
	canonical, err := canonicalize(body)
	if err != nil {
		return false, fmt.Sprintf("invalid body: %s", err.Error())
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(canonical)
	expectedHex := hex.EncodeToString(mac.Sum(nil))

	provided := strings.TrimSpace(signature)
	if len(provided) != len(expectedHex) || !hmac.Equal([]byte(strings.ToLower(provided)), []byte(expectedHex)) {
		return false, "signature mismatch"
	}

	if maxAgeSeconds > 0 {
		var payload struct {
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal(body, &payload); err != nil || payload.Timestamp == "" {
			return false, "missing or invalid timestamp"
		}

		ts, err := time.Parse(time.RFC3339Nano, payload.Timestamp)
		if err != nil {
			ts, err = time.Parse(time.RFC3339, payload.Timestamp)
		}
		if err != nil {
			return false, "missing or invalid timestamp"
		}

		ageSeconds := now.Sub(ts).Seconds()
		if ageSeconds > float64(maxAgeSeconds) {
			return false, fmt.Sprintf("payload too old (%ds > %ds) - possible replay", int(math.Round(ageSeconds)), maxAgeSeconds)
		}
		if ageSeconds < -float64(maxAgeSeconds) {
			return false, fmt.Sprintf("payload timestamp is in the future (%ds ahead)", int(math.Round(-ageSeconds)))
		}
	}

	return true, "valid"
}

func main() {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	secret := fs.String("secret", "", "your webhook signing secret")
	signature := fs.String("signature", "", "value of the X-OphirPay-Signature header")
	bodyFile := fs.String("body-file", "", "path to the received JSON body (defaults to stdin)")
	maxAge := fs.Int("max-age", defaultMaxAgeSeconds, "replay window in seconds (0 disables)")
	nowStr := fs.String("now", "", "reference timestamp (ISO 8601); defaults to the current time")

	if err := fs.Parse(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(2)
	}

	if *secret == "" || *signature == "" {
		fmt.Fprintf(os.Stderr, "usage: go run verify.go --secret <secret> --signature <hex> [--body-file <path>] [--max-age <seconds>] [--now <iso>]\n")
		os.Exit(2)
	}

	var body []byte
	var err error
	if *bodyFile != "" {
		body, err = os.ReadFile(*bodyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "INVALID: failed to read body file: %v\n", err)
			os.Exit(1)
		}
	} else {
		body, err = io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "INVALID: failed to read stdin: %v\n", err)
			os.Exit(1)
		}
	}

	refTime := time.Now().UTC()
	if *nowStr != "" {
		parsedNow, err := time.Parse(time.RFC3339Nano, *nowStr)
		if err != nil {
			parsedNow, err = time.Parse(time.RFC3339, *nowStr)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "INVALID: invalid --now timestamp: %v\n", err)
			os.Exit(1)
		}
		refTime = parsedNow.UTC()
	}

	valid, reason := verifyWebhookSignature(body, *signature, *secret, *maxAge, refTime)
	if valid {
		fmt.Println("VALID")
		os.Exit(0)
	}

	fmt.Fprintf(os.Stderr, "INVALID: %s\n", reason)
	os.Exit(1)
}
