// SPDX-License-Identifier: MIT

// OphirPay webhook signature verification — reference implementation (Go)
//
// Canonicalization (must match buildSignedPayload in src/lib/webhook-deliver.ts):
//
//  1. Parse the received JSON body.
//  2. Set the signature field to "" — keep the key, empty the value.
//     (Do NOT delete the key; the canonical string contains "signature":"".)
//  3. Re-serialize preserving insertion key order.
//     Use compact separators (no whitespace) matching Node's JSON.stringify byte-for-byte.
//  4. Compute HMAC-SHA256 (hex) over that canonical string using your webhook secret.
//  5. Compare against the X-OphirPay-Signature header with a constant-time comparison.
//
// CLI:
//
//   go run verify.go --secret <secret> --signature <hex> \
//       [--body-file <path>] [--max-age <seconds>] [--now <iso>]
//
// Reads the body from --body-file, or stdin when omitted. Prints "VALID"
// and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
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

const defaultMaxAgeSeconds = 300 // default replay-protection window

type keyVal struct {
	key string
	val []byte
}

// Canonicalize builds the canonical string a receiver must sign, byte-for-byte
// identical to what Node's JSON.stringify produces in buildSignedPayload.
func Canonicalize(body string) (string, error) {
	dec := json.NewDecoder(strings.NewReader(body))
	t, err := dec.Token()
	if err != nil {
		return "", fmt.Errorf("body must be valid JSON: %w", err)
	}
	delim, ok := t.(json.Delim)
	if !ok || delim != '{' {
		return "", errors.New("body must be a JSON object")
	}

	var pairs []keyVal
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("invalid token reading key: %w", err)
		}
		key, ok := kt.(string)
		if !ok {
			return "", errors.New("object key must be a string")
		}

		if key == "signature" {
			// Skip actual value of signature field
			var discard json.RawMessage
			if err := dec.Decode(&discard); err != nil {
				return "", fmt.Errorf("failed decoding signature value: %w", err)
			}
			pairs = append(pairs, keyVal{key: key, val: []byte(`""`)})
		} else {
			var rawVal json.RawMessage
			if err := dec.Decode(&rawVal); err != nil {
				return "", fmt.Errorf("failed decoding value for %q: %w", key, err)
			}
			var compactBuf bytes.Buffer
			if err := json.Compact(&compactBuf, rawVal); err != nil {
				return "", fmt.Errorf("failed compacting JSON value for %q: %w", key, err)
			}
			pairs = append(pairs, keyVal{key: key, val: compactBuf.Bytes()})
		}
	}

	// Read closing delimiter
	if _, err := dec.Token(); err != nil {
		return "", fmt.Errorf("invalid JSON trailing structure: %w", err)
	}

	var out bytes.Buffer
	out.WriteByte('{')
	for i, pair := range pairs {
		if i > 0 {
			out.WriteByte(',')
		}
		keyJSON, _ := json.Marshal(pair.key)
		out.Write(keyJSON)
		out.WriteByte(':')
		out.Write(pair.val)
	}
	out.WriteByte('}')

	return out.String(), nil
}

// VerifyWebhookSignature verifies an OphirPay webhook delivery payload.
func VerifyWebhookSignature(body, signature, secret string, maxAgeSeconds int, now time.Time) (bool, string) {
	canonical, err := Canonicalize(body)
	if err != nil {
		return false, fmt.Sprintf("invalid body: %v", err)
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	expected := hex.EncodeToString(mac.Sum(nil))

	provided := strings.TrimSpace(signature)
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return false, "signature mismatch"
	}

	if maxAgeSeconds > 0 {
		var meta struct {
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal([]byte(body), &meta); err != nil || meta.Timestamp == "" {
			return false, "missing or invalid timestamp"
		}

		ts, err := time.Parse(time.RFC3339Nano, meta.Timestamp)
		if err != nil {
			ts, err = time.Parse(time.RFC3339, meta.Timestamp)
			if err != nil {
				return false, "missing or invalid timestamp"
			}
		}

		if now.IsZero() {
			now = time.Now().UTC()
		}

		ageSeconds := now.Sub(ts).Seconds()
		if ageSeconds > float64(maxAgeSeconds) {
			return false, fmt.Sprintf("payload too old (%ds > %ds) — possible replay", int(math.Round(ageSeconds)), maxAgeSeconds)
		}
		if ageSeconds < -float64(maxAgeSeconds) {
			return false, fmt.Sprintf("payload timestamp is in the future (%ds ahead)", int(math.Round(-ageSeconds)))
		}
	}

	return true, "valid"
}

func main() {
	secretFlag := flag.String("secret", "", "your webhook signing secret")
	sigFlag := flag.String("signature", "", "value of the X-OphirPay-Signature header")
	bodyFileFlag := flag.String("body-file", "", "path to the received JSON body (defaults to stdin)")
	maxAgeFlag := flag.Int("max-age", defaultMaxAgeSeconds, "replay window in seconds (0 disables)")
	nowFlag := flag.String("now", "", "reference timestamp (ISO 8601/RFC 3339); defaults to current time")

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: go run verify.go --secret <secret> --signature <hex> [--body-file <path>] [--max-age <seconds>] [--now <iso>]\n")
	}

	flag.Parse()

	if *secretFlag == "" || *sigFlag == "" {
		flag.Usage()
		os.Exit(2)
	}

	var bodyBytes []byte
	var err error
	if *bodyFileFlag != "" {
		bodyBytes, err = os.ReadFile(*bodyFileFlag)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading body file: %v\n", err)
			os.Exit(2)
		}
	} else {
		bodyBytes, err = io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error reading stdin: %v\n", err)
			os.Exit(2)
		}
	}

	var now time.Time
	if *nowFlag != "" {
		now, err = time.Parse(time.RFC3339Nano, *nowFlag)
		if err != nil {
			now, err = time.Parse(time.RFC3339, *nowFlag)
			if err != nil {
				fmt.Fprintf(os.Stderr, "error parsing --now timestamp: %v\n", err)
				os.Exit(2)
			}
		}
	} else {
		now = time.Now().UTC()
	}

	valid, reason := VerifyWebhookSignature(string(bodyBytes), *sigFlag, *secretFlag, *maxAgeFlag, now)
	if valid {
		fmt.Println("VALID")
		os.Exit(0)
	}

	fmt.Fprintf(os.Stderr, "INVALID: %s\n", reason)
	os.Exit(1)
}
