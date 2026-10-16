// SPDX-License-Identifier: MIT
/**
 * OphirPay webhook signature verification — reference implementation (Go).
 *
 * Signed material (must match `buildSignedPayload` in
 * `src/lib/webhook-deliver.ts`):
 *
 *   <timestamp>.<canonicalBody>
 *
 *   1. Take the timestamp: the `X-OphirPay-Timestamp` header value, falling
 *      back to the (also-signed) `timestamp` field of the body when absent.
 *   2. Unmarshal the received JSON body into an ordered representation.
 *   3. Set the `signature` field to "" — keep the key, empty the value.
 *      (Do NOT delete the key; the canonical string contains `"signature":""`.)
 *   4. Re-serialize with the key order of the received body, and with JSON
 *      string escaping that matches Go's `encoding/json` on the *decoded*
 *      values. If your receiver re-encodes, the bytes must match Node's
 *      JSON.stringify of the parsed body — see the canonicalization note in
 *      docs/webhook-verification.md: any difference in whitespace or key
 *      order changes the HMAC and must fail verification.
 *   5. Compute HMAC-SHA256 (hex) over `<timestamp>.<canonicalBody>` with your
 *      webhook secret.
 *   6. Compare against the `X-OphirPay-Signature` header with a
 *      constant-time comparison (hmac.Equal).
 *   7. Reject a timestamp outside the freshness window (replay protection).
 *
 * CLI:
 *
 *   go run ./verify.go --secret <secret> --signature <hex> \
 *     [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]
 *
 * Reads the body from `--body-file`, or stdin when omitted. Prints "VALID"
 * and exits 0 on success, or "INVALID: <reason>" and exits 1 otherwise.
 */
package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
	"time"
)

const defaultMaxAgeSeconds = 300 // replay-protection window

// canonicalize builds the canonical string a receiver must sign, byte-for-byte
// identical to what buildSignedPayload signs on the sender side.
//
// The sender is Node.js: `JSON.stringify({...payload, signature: ""})` after
// `JSON.parse(body)`. Decoding into `map[string]any` and re-encoding with
// encoding/json reproduces those bytes for typical webhook payloads:
//   - object keys are emitted in the order they were decoded (orderedMap
//     below preserves the received order, matching Node's insertion-order
//     semantics for non-numeric keys);
//   - strings/numbers/booleans/null round-trip identically.
//
// If the incoming body differs from the canonical form in whitespace or key
// order, the computed HMAC will not match the header and verification fails
// with "signature mismatch" — which is the required behavior for a tampered
// or re-serialized delivery.
func canonicalize(body []byte) ([]byte, error) {
	ordered, err := decodeOrderedObject(body)
	if err != nil {
		return nil, err
	}

	// Empty the signature field instead of deleting it: the HMAC input
	// includes "signature":"" as the last key (matching Node's
	// `JSON.stringify({...parsed, signature: ""})`).
	ordered.set("signature", &orderedValue{kind: 's', raw: []byte(`""`)})

	return ordered.marshal()
}

// signedTimestamp resolves the timestamp that is bound into the signature:
// the header value when present, otherwise the body's (signed) timestamp.
func signedTimestamp(headerTimestamp string, body []byte) string {
	if headerTimestamp != "" {
		return headerTimestamp
	}
	var probe struct {
		Timestamp string `json:"timestamp"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return ""
	}
	return probe.Timestamp
}

// verify checks an OphirPay webhook delivery.
func verify(body []byte, signature, secret, headerTimestamp string, maxAgeSeconds int, now time.Time) (bool, string) {
	canonical, err := canonicalize(body)
	if err != nil {
		return false, err.Error()
	}

	ts := signedTimestamp(headerTimestamp, body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "." + string(canonical)))
	expected := mac.Sum(nil)

	provided, err := hex.DecodeString(strings.ToLower(strings.TrimSpace(signature)))
	if err != nil || !hmac.Equal(provided, expected) {
		return false, "signature mismatch"
	}

	if maxAgeSeconds > 0 {
		sent, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			return false, "missing or invalid timestamp"
		}
		age := now.Sub(sent).Seconds()
		if age > float64(maxAgeSeconds) {
			return false, fmt.Sprintf("WebhookTimestampExpired: payload too old (%.0fs > %ds) — possible replay", age, maxAgeSeconds)
		}
		if age < -float64(maxAgeSeconds) {
			return false, fmt.Sprintf("WebhookTimestampFutureSkew: payload timestamp is in the future (%.0fs ahead)", -age)
		}
	}

	return true, "valid"
}

// ── Ordered JSON object support ────────────────────────────────────────────
//
// encoding/json sorts map keys, which would silently canonicalize a tampered
// body into the same bytes as the original. To reproduce Node's behavior —
// where re-serialization preserves the key order of the parsed object — the
// decoder walks the raw JSON and records each key's position.

type orderedValue struct {
	kind  byte // 'o' object, 'a' array, else scalar (raw literal or string)
	raw   []byte
	str   string // for string scalars (already JSON-escaped)
	obj   *orderedObject
	arr   []*orderedValue
}

type orderedMember struct {
	key   string // decoded key text
	keyJSON []byte // key as it appeared in the source (escaped)
	value *orderedValue
}

type orderedObject struct {
	members []orderedMember
}

func (o *orderedObject) set(key string, v *orderedValue) {
	for i := range o.members {
		if o.members[i].key == key {
			o.members[i].value = v
			o.members[i].keyJSON = encodeString(key)
			return
		}
	}
	o.members = append(o.members, orderedMember{key: key, keyJSON: encodeString(key), value: v})
}

func (o *orderedObject) get(key string) *orderedValue {
	for i := range o.members {
		if o.members[i].key == key {
			return o.members[i].value
		}
	}
	return nil
}

// marshal re-encodes the value with keys in received order, matching the byte
// output of Node's JSON.stringify over the parsed body (no extra whitespace).
func (o *orderedObject) marshal() ([]byte, error) {
	var b strings.Builder
	b.WriteByte('{')
	for i, m := range o.members {
		if i > 0 {
			b.WriteByte(',')
		}
		b.Write(m.keyJSON)
		b.WriteByte(':')
		if err := writeValue(&b, m.value); err != nil {
			return nil, err
		}
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}

func writeValue(b *strings.Builder, v *orderedValue) error {
	switch v.kind {
	case 'o':
		out, err := v.obj.marshal()
		if err != nil {
			return err
		}
		b.Write(out)
	case 'a':
		b.WriteByte('[')
		for i, item := range v.arr {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeValue(b, item); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	default:
		if v.raw != nil {
			b.Write(v.raw)
		} else {
			b.WriteString(v.str)
		}
	}
	return nil
}

// encodeString JSON-escapes s the way encoding/json does by default, matching
// Node's JSON.stringify for the decoded values seen in webhook payloads.
func encodeString(s string) []byte {
	out, err := json.Marshal(s)
	if err != nil {
		// Marshal of a string cannot fail; defensive fallback.
		return []byte(`""`)
	}
	return out
}

// decodeOrderedObject parses raw JSON preserving object key order.
func decodeOrderedObject(data []byte) (*orderedObject, error) {
	p := &parser{src: data}
	p.skipWS()
	v, err := p.parseValue()
	if err != nil {
		return nil, err
	}
	p.skipWS()
	if p.pos != len(p.src) {
		return nil, fmt.Errorf("invalid body: unexpected trailing data")
	}
	if v.kind != 'o' {
		return nil, fmt.Errorf("body must be a JSON object")
	}
	return v.obj, nil
}

type parser struct {
	src []byte
	pos int
}

func (p *parser) skipWS() {
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		default:
			return
		}
	}
}

func (p *parser) peek() byte {
	if p.pos >= len(p.src) {
		return 0
	}
	return p.src[p.pos]
}

func (p *parser) parseValue() (*orderedValue, error) {
	p.skipWS()
	switch p.peek() {
	case '{':
		return p.parseObject()
	case '[':
		return p.parseArray()
	case '"':
		raw, err := p.parseStringRaw()
		if err != nil {
			return nil, err
		}
		// String scalars are re-emitted with the exact escaping they were
		// received with, which matches Node's JSON.stringify for the decoded
		// values carried by webhook payloads.
		return &orderedValue{kind: 's', raw: raw}, nil
	default:
		return p.parseLiteral()
	}
}

func (p *parser) parseObject() (*orderedValue, error) {
	p.pos++ // consume '{'
	obj := &orderedObject{}
	p.skipWS()
	if p.peek() == '}' {
		p.pos++
		return &orderedValue{kind: 'o', obj: obj}, nil
	}
	for {
		p.skipWS()
		if p.peek() != '"' {
			return nil, fmt.Errorf("invalid body: expected object key")
		}
		keyRaw, err := p.parseStringRaw()
		if err != nil {
			return nil, err
		}
		var key string
		if err := json.Unmarshal(keyRaw, &key); err != nil {
			return nil, fmt.Errorf("invalid body: bad key")
		}
		p.skipWS()
		if p.peek() != ':' {
			return nil, fmt.Errorf("invalid body: expected ':'")
		}
		p.pos++
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		obj.members = append(obj.members, orderedMember{key: key, keyJSON: keyRaw, value: val})
		p.skipWS()
		switch p.peek() {
		case ',':
			p.pos++
		case '}':
			p.pos++
			return &orderedValue{kind: 'o', obj: obj}, nil
		default:
			return nil, fmt.Errorf("invalid body: expected ',' or '}'")
		}
	}
}

func (p *parser) parseArray() (*orderedValue, error) {
	p.pos++ // consume '['
	arr := &orderedValue{kind: 'a'}
	p.skipWS()
	if p.peek() == ']' {
		p.pos++
		return arr, nil
	}
	for {
		val, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		arr.arr = append(arr.arr, val)
		p.skipWS()
		switch p.peek() {
		case ',':
			p.pos++
		case ']':
			p.pos++
			return arr, nil
		default:
			return nil, fmt.Errorf("invalid body: expected ',' or ']'")
		}
	}
}

// parseStringRaw returns the raw quoted token including quotes.
func (p *parser) parseStringRaw() ([]byte, error) {
	if p.peek() != '"' {
		return nil, fmt.Errorf("invalid body: expected string")
	}
	start := p.pos
	p.pos++
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == '\\' {
			p.pos += 2
			continue
		}
		if c == '"' {
			p.pos++
			return p.src[start:p.pos], nil
		}
		p.pos++
	}
	return nil, fmt.Errorf("invalid body: unterminated string")
}

func (p *parser) parseString() (string, error) {
	raw, err := p.parseStringRaw()
	if err != nil {
		return "", err
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", fmt.Errorf("invalid body: bad string")
	}
	return s, nil
}
func (p *parser) parseLiteral() (*orderedValue, error) {
	start := p.pos
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if c == ',' || c == '}' || c == ']' || c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			break
		}
		p.pos++
	}
	raw := p.src[start:p.pos]
	if len(raw) == 0 {
		return nil, fmt.Errorf("invalid body: unexpected end of input")
	}
	// Validate and normalize scalars the way Node would print them.
	// UseNumber keeps the sender's exact numeric formatting instead of
	// collapsing it through float64.
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("invalid body: bad literal %q", string(raw))
	}
	switch num := v.(type) {
	case json.Number:
		// Keep the sender's exact numeric formatting (Node prints integers
		// without a decimal point; floats via shortest round-trip). Both
		// match what produced the signature because the receiver signs the
		// same bytes it received for scalars.
		if f, err := num.Float64(); err == nil && (math.IsNaN(f) || math.IsInf(f, 0)) {
			return nil, fmt.Errorf("invalid body: unsupported number")
		}
	case nil, bool:
	default:
		return nil, fmt.Errorf("invalid body: unsupported literal")
	}
	return &orderedValue{kind: 'l', raw: raw}, nil
}

// ── CLI ────────────────────────────────────────────────────────────────────

func main() {
	secret := flag.String("secret", "", "webhook signing secret")
	signature := flag.String("signature", "", "hex value of the X-OphirPay-Signature header")
	timestamp := flag.String("timestamp", "", "value of the X-OphirPay-Timestamp header (optional)")
	bodyFile := flag.String("body-file", "", "path to the raw request body (reads stdin when omitted)")
	maxAge := flag.Int("max-age", defaultMaxAgeSeconds, "replay window in seconds (0 disables)")
	nowStr := flag.String("now", "", "reference time as RFC3339 (defaults to the current time)")
	flag.Parse()

	if *secret == "" || *signature == "" {
		fmt.Fprintln(os.Stderr, "usage: verify.go --secret <secret> --signature <hex> [--timestamp <iso>] [--body-file <path>] [--max-age <seconds>] [--now <iso>]")
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
		fmt.Fprintf(os.Stderr, "error: reading body: %v\n", err)
		os.Exit(2)
	}

	now := time.Now().UTC()
	if *nowStr != "" {
		now, err = time.Parse(time.RFC3339, *nowStr)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: invalid --now: %v\n", err)
			os.Exit(2)
		}
	}

	ok, reason := verify(body, *signature, *secret, *timestamp, *maxAge, now)
	if ok {
		fmt.Println("VALID")
		os.Exit(0)
	}
	fmt.Fprintf(os.Stderr, "INVALID: %s\n", reason)
	os.Exit(1)
}
