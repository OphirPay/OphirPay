// SPDX-License-Identifier: MIT

// Command verify confirms an OphirPay webhook delivery.
//
// It is a reference implementation, byte-for-byte compatible with the Node
// (examples/webhook-verification/node/verify.mjs) and Python
// (examples/webhook-verification/python/verify.py) versions. Signed material
// must match buildSignedPayload in src/lib/webhook-deliver.ts:
//
//	<timestamp>.<canonicalBody>
//
// Canonicalization — the part that is easy to get wrong:
//
//  1. Parse the received JSON body into a map.
//  2. Empty the "signature" field: keep the key, set the value to "".
//     (Do NOT delete the key; the canonical string contains "signature":"" .)
//  3. Re-serialize preserving the received key order, with "signature" moved
//     to the END. Node's canonicalize does `{ ...parsed, signature: "" }`,
//     which re-inserts the key at the last position, so a receiver that emits
//     it in its original position produces a different byte string and fails.
//  4. Serialize with Go's encoding/json: no HTML escaping (to match
//     JSON.stringify, which does not escape < > &), no newline, and
//     json.Marshal escapes exactly like JSON.stringify for the value types
//     used in payloads.
//  5. HMAC-SHA256 (hex) over "<timestamp>.<canonicalBody>" with your secret.
//  6. Compare with the X-OphirPay-Signature header using hmac.Equal
//     (constant time).
//  7. Reject a timestamp outside the freshness window (replay protection).
//
// Usage:
//
//	go run verify.go --secret <secret> --signature <hex> \
//	  [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]
//
// Reads the body from --body-file, or stdin when omitted. Prints "VALID" and
// exits 0 on success, or "INVALID: <reason>" on stderr and exits 1 otherwise.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"
)

// DefaultMaxAgeSeconds is the default replay-protection window.
const DefaultMaxAgeSeconds = 300

// canonicalBody re-derives the exact byte string that buildSignedPayload signs
// on the sender side.
//
// Go's encoding/json sorts map keys alphabetically, and JSON.stringify does
// not — so a plain map round-trip cannot reproduce the wire order. This
// function therefore re-emits the object itself from a token stream, which
// preserves the order the keys arrived in, and moves "signature" to the end
// (mirroring the sender's `{ ...parsed, signature: "" }`).
func canonicalBody(body []byte) (string, error) {
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()

	tok, err := dec.Token()
	if err != nil {
		return "", fmt.Errorf("invalid body: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return "", errors.New("body must be a JSON object")
	}

	var sb strings.Builder
	if err := writeCanonicalObject(&sb, dec); err != nil {
		return "", err
	}
	return sb.String(), nil
}

// writeCanonicalObject consumes a decoded object (the opening '{' has already
// been read) and writes it in received key order, with "signature" last and
// emptied.
func writeCanonicalObject(sb *strings.Builder, dec *json.Decoder) error {
	type kv struct {
		key string
		val json.Token
	}
	var (
		fields []kv
		sigSet bool
		dupKey bool
	)

	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return fmt.Errorf("invalid body: %w", err)
		}
		key, ok := keyTok.(string)
		if !ok {
			return errors.New("invalid body: object key must be a string")
		}
		if key == "signature" {
			if sigSet {
				dupKey = true
			}
			sigSet = true
		}
		val, err := writeCanonicalToken(dec)
		if err != nil {
			return err
		}
		if key == "signature" {
			// The canonical form carries an emptied signature key, so the
			// received value is dropped — but a duplicate would silently
			// verify against bytes the sender never produced.
			continue
		}
		for _, f := range fields {
			if f.key == key {
				dupKey = true
			}
		}
		fields = append(fields, kv{key: key, val: val})
	}
	// Consume the closing '}'.
	if _, err := dec.Token(); err != nil {
		return fmt.Errorf("invalid body: %w", err)
	}
	if dupKey {
		return errors.New(`body contains a duplicate object key`)
	}

	sb.WriteByte('{')
	for i, f := range fields {
		if i > 0 {
			sb.WriteByte(',')
		}
		kb, err := json.Marshal(f.key)
		if err != nil {
			return err
		}
		sb.Write(kb)
		sb.WriteByte(':')
		writeCanonicalTokenValue(sb, f.val)
	}
	if sigSet {
		if len(fields) > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(`"signature":""`)
	}
	sb.WriteByte('}')
	return nil
}

// writeCanonicalToken reads one JSON value from the decoder and returns it in
// a form that preserves key order when re-emitted.
//
// Objects become *orderedObject, arrays become []any, and scalars become the
// matching json.Token (string, json.Number, bool, or nil).
func writeCanonicalToken(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, fmt.Errorf("invalid body: %w", err)
	}
	return convertToken(tok, dec)
}

func convertToken(tok json.Token, dec *json.Decoder) (any, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			var fields []orderedField
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key := keyTok.(string)
				val, err := convertToken2(dec)
				if err != nil {
					return nil, err
				}
				if key == "signature" {
					// emptied, kept at its received position for nested objects
					fields = append(fields, orderedField{key: key, val: "" })
					continue
				}
				fields = append(fields, orderedField{key: key, val: val})
			}
			if _, err := dec.Token(); err != nil { // closing '}'
				return nil, err
			}
			return &orderedObject{fields: fields}, nil
		case '[':
			var items []any
			for dec.More() {
				v, err := convertToken2(dec)
				if err != nil {
					return nil, err
				}
				items = append(items, v)
			}
			if _, err := dec.Token(); err != nil { // closing ']'
				return nil, err
			}
			return items, nil
		}
		return nil, fmt.Errorf("unexpected delimiter %v", t)
	default:
		return tok, nil
	}
}

// convertToken2 is convertToken narrowed for a value position (never a
// delimiter-start of an object), kept separate for readability.
func convertToken2(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return convertToken(tok, dec)
}

type orderedField struct {
	key string
	val any
}

// orderedObject serializes with the key order it was decoded in.
type orderedObject struct {
	fields []orderedField
}

// writeCanonicalTokenValue emits v the way JSON.stringify would: compact, no
// trailing newline, no HTML escaping.
func writeCanonicalTokenValue(sb *strings.Builder, v any) {
	switch t := v.(type) {
	case *orderedObject:
		sb.WriteByte('{')
		for i, f := range t.fields {
			if i > 0 {
				sb.WriteByte(',')
			}
			kb, _ := json.Marshal(f.key)
			sb.Write(kb)
			sb.WriteByte(':')
			writeCanonicalTokenValue(sb, f.val)
		}
		sb.WriteByte('}')
	case []any:
		sb.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				sb.WriteByte(',')
			}
			writeCanonicalTokenValue(sb, item)
		}
		sb.WriteByte(']')
	case string:
		b, _ := marshalNoHTMLEscape(t)
		sb.Write(b)
	case json.Number:
		sb.WriteString(t.String())
	case bool:
		if t {
			sb.WriteString("true")
		} else {
			sb.WriteString("false")
		}
	case nil:
		sb.WriteString("null")
	default:
		// json.Token strings arrive as plain string, other types as-is.
		b, _ := marshalNoHTMLEscape(v)
		sb.Write(b)
	}
}

// marshalNoHTMLEscape mirrors JSON.stringify: it does not escape <, > or &.
func marshalNoHTMLEscape(v any) ([]byte, error) {
	var buf strings.Builder
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return []byte(strings.TrimRight(buf.String(), "\n")), nil
}

// VerifyWebhookSignature checks one delivery.
type Result struct {
	Valid  bool
	Reason string
}

func VerifyWebhookSignature(body []byte, signature, secret, headerTimestamp string, maxAgeSeconds int, now time.Time) Result {
	if len(body) == 0 {
		return Result{false, "empty body"}
	}

	// The timestamp is authenticated: it is prepended to the canonical body.
	// Prefer the header, fall back to the (also signed) body field.
	signedTimestamp := headerTimestamp
	if signedTimestamp == "" {
		var probe struct {
			Timestamp string `json:"timestamp"`
		}
		if err := json.Unmarshal(body, &probe); err != nil || probe.Timestamp == "" {
			return Result{false, "missing timestamp"}
		}
		signedTimestamp = probe.Timestamp
	}

	canonical, err := canonicalBody(body)
	if err != nil {
		return Result{false, err.Error()}
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedTimestamp + "." + canonical))
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signature))) {
		return Result{false, "signature mismatch"}
	}

	if maxAgeSeconds > 0 {
		ts, err := time.Parse(time.RFC3339, signedTimestamp)
		if err != nil {
			return Result{false, "missing or invalid timestamp"}
		}
		window := time.Duration(maxAgeSeconds) * time.Second
		age := now.Sub(ts)
		if age > window {
			return Result{false, fmt.Sprintf("payload too old (%ds > %ds) — possible replay", int(age.Seconds()), maxAgeSeconds)}
		}
		if age < -window {
			return Result{false, fmt.Sprintf("payload timestamp is in the future (%ds ahead)", int(-age.Seconds()))}
		}
	}

	return Result{true, "valid"}
}

func main() {
	var (
		secret     = flag.String("secret", "", "webhook signing secret")
		signature  = flag.String("signature", "", "value of the X-OphirPay-Signature header")
		timestamp  = flag.String("timestamp", "", "value of the X-OphirPay-Timestamp header (optional)")
		bodyFile   = flag.String("body-file", "", "path to the raw request body (defaults to stdin)")
		maxAge     = flag.Int("max-age", DefaultMaxAgeSeconds, "replay window in seconds; 0 disables the check")
		nowStr     = flag.String("now", "", "reference time (RFC 3339) for the replay check")
	)
	flag.Parse()

	usage := "usage: go run verify.go --secret <secret> --signature <hex> [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]"
	if *secret == "" || *signature == "" {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}

	var body []byte
	var err error
	if *bodyFile != "" {
		body, err = os.ReadFile(*bodyFile)
	} else {
		body, err = io.ReadAll(os.Stdin)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(2)
	}

	now := time.Now()
	if *nowStr != "" {
		now, err = time.Parse(time.RFC3339, *nowStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: invalid --now value %q: %v\n", *nowStr, err)
			os.Exit(2)
		}
	}

	res := VerifyWebhookSignature(body, *signature, *secret, *timestamp, *maxAge, now)
	if res.Valid {
		fmt.Println("VALID")
		os.Exit(0)
	}
	fmt.Fprintf(os.Stderr, "INVALID: %s\n", res.Reason)
	os.Exit(1)
}

// keep sort imported for potential future key-order diagnostics
var _ = sort.Strings
