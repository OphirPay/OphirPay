// SPDX-License-Identifier: MIT
// OphirPay webhook signature verification — reference implementation (Go)
//
// Canonicalization (must match buildSignedPayload in src/lib/webhook-deliver.ts):
//
//   1. Parse the received JSON body preserving key order.
//   2. Set the `signature` field to "" — keep the key, empty the value.
//      (Do NOT delete the key; the canonical string contains `"signature":""`.)
//   3. Re-serialize without superfluous whitespace.
//   4. Compute HMAC-SHA256 (hex) over that canonical string using your webhook secret.
//   5. Compare against the X-OphirPay-Signature header with constant-time comparison.
//
// CLI:
//   go run main.go --secret <secret> --signature <hex> \
//     [--body-file <path>] [--max-age <seconds>] [--now <iso>]
//
// Reads the body from `--body-file`, or stdin when omitted. Prints "VALID"
// and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.

package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"time"
)

const defaultMaxAgeSeconds = 300 // 5-minute replay-protection window

type KeyValue struct {
	Key   string
	Value any
}

type OrderedObject []KeyValue

func decodeOrdered(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}

	delim, ok := tok.(json.Delim)
	if !ok {
		return tok, nil
	}

	switch delim {
	case '{':
		var obj OrderedObject
		for dec.More() {
			keyTok, err := dec.Token()
			if err != nil {
				return nil, err
			}
			key, ok := keyTok.(string)
			if !ok {
				return nil, fmt.Errorf("expected string object key")
			}
			val, err := decodeOrdered(dec)
			if err != nil {
				return nil, err
			}
			obj = append(obj, KeyValue{Key: key, Value: val})
		}
		// consume closing '}'
		_, err = dec.Token()
		return obj, err

	case '[':
		var arr []any
		for dec.More() {
			val, err := decodeOrdered(dec)
			if err != nil {
				return nil, err
			}
			arr = append(arr, val)
		}
		// consume closing ']'
		_, err = dec.Token()
		return arr, err

	default:
		return nil, fmt.Errorf("unexpected delimiter: %v", delim)
	}
}

func encodeCanonical(v any, buf *bytes.Buffer) error {
	switch val := v.(type) {
	case OrderedObject:
		buf.WriteByte('{')
		for i, kv := range val {
			if i > 0 {
				buf.WriteByte(',')
			}
			keyBytes, err := json.Marshal(kv.Key)
			if err != nil {
				return err
			}
			buf.Write(keyBytes)
			buf.WriteByte(':')
			if kv.Key == "signature" {
				buf.WriteString(`""`)
			} else {
				if err := encodeCanonical(kv.Value, buf); err != nil {
					return err
				}
			}
		}
		buf.WriteByte('}')
	case []any:
		buf.WriteByte('[')
		for i, item := range val {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := encodeCanonical(item, buf); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return err
		}
		buf.Write(b)
	}
	return nil
}

// Canonicalize builds the canonical string identical byte-for-byte to what Node's JSON.stringify produces.
func Canonicalize(body []byte) (string, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	obj, err := decodeOrdered(dec)
	if err != nil {
		return "", err
	}
	orderedObj, ok := obj.(OrderedObject)
	if !ok {
		return "", fmt.Errorf("body must be a JSON object")
	}

	var buf bytes.Buffer
	if err := encodeCanonical(orderedObj, &buf); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// VerifyWebhookSignature validates the signature and replay-window of an OphirPay webhook payload.
func VerifyWebhookSignature(body []byte, signature, secret string, maxAgeSeconds int, now time.Time) (bool, string) {
	canonical, err := Canonicalize(body)
	if err != nil {
		return false, fmt.Sprintf("invalid body: %v", err)
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	expected := hex.EncodeToString(mac.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(signature), []byte(expected)) != 1 {
		return false, "signature mismatch"
	}

	if maxAgeSeconds > 0 {
		var rawMap map[string]any
		if err := json.Unmarshal(body, &rawMap); err != nil {
			return false, "invalid body"
		}
		tsStr, ok := rawMap["timestamp"].(string)
		if !ok || tsStr == "" {
			return false, "missing or invalid timestamp"
		}
		ts, err := time.Parse(time.RFC3339Nano, tsStr)
		if err != nil {
			ts, err = time.Parse(time.RFC3339, tsStr)
			if err != nil {
				return false, "missing or invalid timestamp"
			}
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
	secret := flag.String("secret", "", "your webhook signing secret")
	signature := flag.String("signature", "", "value of the X-OphirPay-Signature header")
	bodyFile := flag.String("body-file", "", "path to the received JSON body (defaults to stdin)")
	maxAge := flag.Int("max-age", defaultMaxAgeSeconds, "replay window in seconds (0 disables)")
	nowStr := flag.String("now", "", "reference timestamp (ISO 8601); defaults to current time")
	flag.Parse()

	if *secret == "" || *signature == "" {
		fmt.Fprintln(os.Stderr, "usage: go run main.go --secret <secret> --signature <hex> [--body-file <path>] [--max-age <seconds>] [--now <iso>]")
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

	now := time.Now().UTC()
	if *nowStr != "" {
		parsedNow, err := time.Parse(time.RFC3339Nano, *nowStr)
		if err != nil {
			parsedNow, err = time.Parse(time.RFC3339, *nowStr)
			if err != nil {
				fmt.Fprintf(os.Stderr, "INVALID: invalid --now format: %v\n", err)
				os.Exit(1)
			}
		}
		now = parsedNow.UTC()
	}

	valid, reason := VerifyWebhookSignature(body, *signature, *secret, *maxAge, now)
	if valid {
		fmt.Println("VALID")
		os.Exit(0)
	}
	fmt.Fprintf(os.Stderr, "INVALID: %s\n", reason)
	os.Exit(1)
}
