// SPDX-License-Identifier: MIT

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The committed docs sample: secret + `<timestamp>.<canonical body>` must
// produce exactly this signature. Mirrors SAMPLE_SIGNATURE in
// src/__tests__/webhook-verification-examples.test.ts.
const (
	sampleSecret    = "test-secret-0123456789"
	sampleSignature = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
	sampleTimestamp = "2026-08-14T00:00:00Z"
	sampleReceived  = "2026-08-14T00:00:30Z"
)

var sampleBody = []byte(`{
  "event": "payment.created",
  "timestamp": "2026-08-14T00:00:00Z",
  "data": { "id": "p_123", "amount": 100 },
  "signature": "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
}`)

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("bad time %q: %v", s, err)
	}
	return ts
}

// samplePayloadFile returns the repo's committed sample-payload.json so the
// verifier is exercised against the real fixture, not a copy.
func samplePayloadFile(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "sample-payload.json"))
	if err != nil {
		t.Fatalf("read sample-payload.json: %v", err)
	}
	return b
}

func TestVerifyCommittedSamplePayload(t *testing.T) {
	body := samplePayloadFile(t)

	res := VerifyWebhookSignature(body, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if !res.Valid {
		t.Fatalf("committed sample payload must verify, got: %s", res.Reason)
	}
}

func TestVerifyRejectsTamperedBody(t *testing.T) {
	tampered := []byte(`{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":999},"signature":"` + sampleSignature + `"}`)

	res := VerifyWebhookSignature(tampered, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if res.Valid {
		t.Fatal("tampered amount must not verify")
	}
	if res.Reason != "signature mismatch" {
		t.Fatalf("expected 'signature mismatch', got %q", res.Reason)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	res := VerifyWebhookSignature(sampleBody, sampleSignature, "wrong-secret", sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if res.Valid {
		t.Fatal("wrong secret must not verify")
	}
}

func TestVerifyRejectsReplayedDelivery(t *testing.T) {
	// One hour after the payload timestamp exceeds the 300s window.
	res := VerifyWebhookSignature(sampleBody, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, "2026-08-14T01:00:00Z"))
	if res.Valid {
		t.Fatal("a delivery an hour old must be rejected")
	}
	if !contains(res.Reason, "too old") {
		t.Fatalf("expected a 'too old' reason, got %q", res.Reason)
	}
}

func TestVerifyRejectsFutureTimestamp(t *testing.T) {
	future := VerifyWebhookSignature(sampleBody, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, "2026-08-13T23:00:00Z"))
	if future.Valid {
		t.Fatal("a timestamp an hour in the future must be rejected")
	}
}

func TestVerifyAcceptsWhitespaceOnlyDifference(t *testing.T) {
	// Re-formatting the JSON (extra spaces) must not change the canonical
	// form, so it still verifies — this is the point of canonicalization.
	spaced := []byte(`{
  "event" : "payment.created",
  "timestamp" : "2026-08-14T00:00:00Z",
  "data" : { "id" : "p_123", "amount" : 100 },
  "signature" : "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
}`)

	res := VerifyWebhookSignature(spaced, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if !res.Valid {
		t.Fatalf("whitespace-only reformatting must still verify, got: %s", res.Reason)
	}
}

func TestVerifyRejectsKeyOrderDifference(t *testing.T) {
	// Canonicalization preserves the RECEIVED key order (it mirrors Node's
	// JSON.stringify), so reordering keys changes the canonical form and the
	// signature no longer matches. Whitespace is irrelevant; order is not.
	reordered := []byte(`{"timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"event":"payment.created","signature":"` + sampleSignature + `"}`)

	res := VerifyWebhookSignature(reordered, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if res.Valid {
		t.Fatal("reordering keys changes the canonical form, so it must not verify")
	}
	if res.Reason != "signature mismatch" {
		t.Fatalf("expected 'signature mismatch', got %q", res.Reason)
	}
}

func TestVerifyAcceptsNestedKeyOrderDifference(t *testing.T) {
	// Nested objects behave the same way, which is what most hand-written
	// receivers get wrong: they re-emit a decoded map with sorted keys.
	nestedReordered := []byte(`{"timestamp":"2026-08-14T00:00:00Z","data":{"amount":100,"id":"p_123"},"event":"payment.created","signature":"` + sampleSignature + `"}`)

	res := VerifyWebhookSignature(nestedReordered, sampleSignature, sampleSecret, sampleTimestamp, DefaultMaxAgeSeconds, mustTime(t, sampleReceived))
	if res.Valid {
		t.Fatal("reordering nested keys changes the canonical form, so it must not verify")
	}
}

func TestCanonicalBodyMovesSignatureLast(t *testing.T) {
	// A body whose signature is NOT last must canonicalize identically to one
	// where it is. Node's `{ ...parsed, signature: "" }` always re-inserts it
	// at the end; Go must match byte-for-byte.
	first := []byte(`{"signature":"abc","event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100}}`)
	last := []byte(`{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":"abc"}`)

	a, err := canonicalBody(first)
	if err != nil {
		t.Fatalf("canonicalBody(first): %v", err)
	}
	b, err := canonicalBody(last)
	if err != nil {
		t.Fatalf("canonicalBody(last): %v", err)
	}
	if a != b {
		t.Fatalf("canonical form depends on signature position:\n first: %s\n last : %s", a, b)
	}
	if !contains(a, `"signature":""`) {
		t.Fatalf("canonical body must contain an emptied signature key, got: %s", a)
	}
	if !contains(a, `"signature":""}`) {
		t.Fatalf("signature key must be the last key, got: %s", a)
	}
}

func TestCanonicalBodyRejectsDuplicateSignature(t *testing.T) {
	dup := []byte(`{"event":"payment.created","signature":"a","signature":"b","timestamp":"2026-08-14T00:00:00Z","data":{}}`)
	if _, err := canonicalBody(dup); err == nil {
		t.Fatal("a body with two signature keys must be rejected")
	}
}

func TestCanonicalBodyRejectsNonObject(t *testing.T) {
	for _, in := range []string{`[]`, `"str"`, `42`, `null`} {
		if _, err := canonicalBody([]byte(in)); err == nil {
			t.Fatalf("non-object body %s must be rejected", in)
		}
	}
}

func TestCanonicalBodyMatchesJSONStringify(t *testing.T) {
	// Go's json.Marshal and JS JSON.stringify agree on these forms. Escaping
	// HTML-sensitive characters is disabled so "<" stays "<" (SetEscapeHTML(false)).
	raw := []byte(`{"event":"x<>&","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":"s"}`)
	got, err := canonicalBody(raw)
	if err != nil {
		t.Fatalf("canonicalBody: %v", err)
	}
	want := `{"event":"x<>&","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}`
	if got != want {
		t.Fatalf("canonical body mismatch:\n got: %s\nwant: %s", got, want)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}
