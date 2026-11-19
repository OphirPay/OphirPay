// SPDX-License-Identifier: MIT
//
// Self-tests for the Go reference verifier. Run from this directory:
//
//	go test ./...
//
// These tests are independent of the TypeScript suite and fail loudly when
// the canonicalization drifts from the documented scheme.
package main

import (
	"strings"
	"testing"
	"time"
)

const (
	testSecret    = "test-secret-0123456789"
	testTimestamp = "2026-08-14T00:00:00Z"
	testSignature = "83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"
)

var testBody = `{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":"83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"}`

func referenceNow() time.Time {
	t, _ := time.Parse(time.RFC3339, "2026-08-14T00:00:30Z")
	return t
}

func TestVerifySamplePayload(t *testing.T) {
	ok, reason := verify([]byte(testBody), testSignature, testSecret, "", 0, referenceNow())
	if !ok {
		t.Fatalf("expected sample payload to verify, got: %s", reason)
	}
}

func TestVerifyWithHeaderTimestamp(t *testing.T) {
	ok, reason := verify([]byte(testBody), testSignature, testSecret, testTimestamp, 0, referenceNow())
	if !ok {
		t.Fatalf("expected header-timestamp verification to pass, got: %s", reason)
	}
}

func TestRejectTamperedBody(t *testing.T) {
	tampered := strings.Replace(testBody, `"amount":100`, `"amount":999`, 1)
	ok, reason := verify([]byte(tampered), testSignature, testSecret, "", 0, referenceNow())
	if ok {
		t.Fatal("expected tampered body to be rejected")
	}
	if reason != "signature mismatch" {
		t.Fatalf("unexpected reason: %s", reason)
	}
}

func TestWhitespaceIsNormalizedLikeNode(t *testing.T) {
	// Canonicalization parses the body and re-serializes it, so whitespace
	// differences are erased before the HMAC is computed — exactly like the
	// Node reference (JSON.parse → JSON.stringify). A re-serialized delivery
	// therefore still verifies; only the canonical bytes are signed.
	respaced := strings.Replace(testBody, `"data":{`, `"data": {`, 1)
	ok, reason := verify([]byte(respaced), testSignature, testSecret, "", 0, referenceNow())
	if !ok {
		t.Fatalf("expected whitespace-normalized body to verify (Node parity), got: %s", reason)
	}
}

func TestRejectKeyReordering(t *testing.T) {
	// Same members, different key order. Canonicalization preserves the
	// received key order (Node insertion-order semantics), so re-ordered
	// keys change the canonical bytes and the HMAC no longer matches —
	// reported as a clear signature mismatch, not a silent pass.
	reordered := `{"timestamp":"2026-08-14T00:00:00Z","event":"payment.created","data":{"amount":100,"id":"p_123"},"signature":"83ab64c58dadec406835ebd9b907b579cb89132098823ec66f2b96dd1ad84258"}`
	ok, reason := verify([]byte(reordered), testSignature, testSecret, "", 0, referenceNow())
	if ok {
		t.Fatal("expected reordered body to be rejected")
	}
	if reason != "signature mismatch" {
		t.Fatalf("unexpected reason: %s", reason)
	}
}

func TestRejectWrongSecret(t *testing.T) {
	ok, _ := verify([]byte(testBody), testSignature, "wrong-secret", "", 0, referenceNow())
	if ok {
		t.Fatal("expected wrong secret to be rejected")
	}
}

func TestRejectReplayedDelivery(t *testing.T) {
	// Default 300s window; delivery seen one hour later.
	now, _ := time.Parse(time.RFC3339, "2026-08-14T01:00:00Z")
	ok, reason := verify([]byte(testBody), testSignature, testSecret, "", defaultMaxAgeSeconds, now)
	if ok {
		t.Fatal("expected replayed delivery to be rejected")
	}
	if !strings.Contains(reason, "too old") {
		t.Fatalf("unexpected reason: %s", reason)
	}
}

func TestRejectFutureTimestampBeyondWindow(t *testing.T) {
	now, _ := time.Parse(time.RFC3339, "2026-08-13T22:00:00Z")
	ok, reason := verify([]byte(testBody), testSignature, testSecret, "", defaultMaxAgeSeconds, now)
	if ok {
		t.Fatal("expected future-stamped delivery to be rejected")
	}
	if !strings.Contains(reason, "future") {
		t.Fatalf("unexpected reason: %s", reason)
	}
}

func TestCanonicalizeMatchesNode(t *testing.T) {
	canonical, err := canonicalize([]byte(testBody))
	if err != nil {
		t.Fatalf("canonicalize failed: %v", err)
	}
	expected := `{"event":"payment.created","timestamp":"2026-08-14T00:00:00Z","data":{"id":"p_123","amount":100},"signature":""}`
	if string(canonical) != expected {
		t.Fatalf("canonical form mismatch:\n got: %s\nwant: %s", canonical, expected)
	}
}

func TestCanonicalizeRejectsNonObject(t *testing.T) {
	if _, err := canonicalize([]byte(`[1,2,3]`)); err == nil {
		t.Fatal("expected array body to be rejected")
	}
	if _, err := canonicalize([]byte(`"just a string"`)); err == nil {
		t.Fatal("expected string body to be rejected")
	}
	if _, err := canonicalize([]byte(`not json`)); err == nil {
		t.Fatal("expected invalid JSON to be rejected")
	}
}
