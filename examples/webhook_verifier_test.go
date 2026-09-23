package ophirpay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

func TestVerifyWebhookSignature(t *testing.T) {
	secret := "whsec_test_secret_12345"
	payload := []byte(`{"event":"payment.succeeded","amount":1500}`)
	now := time.Now().Unix()
	timestampStr := strconv.FormatInt(now, 10)

	// Valid signature generation
	signedPayload := timestampStr + "." + string(payload)
	mac := hmacHelper(secret, signedPayload)
	validHeader := "t=" + timestampStr + ",v1=" + mac

	if !VerifyWebhookSignature(payload, validHeader, secret, 5*time.Minute) {
		t.Errorf("Expected signature verification to pass, but failed")
	}

	// Invalid secret test
	if VerifyWebhookSignature(payload, validHeader, "wrong_secret", 5*time.Minute) {
		t.Errorf("Expected signature verification to fail due to wrong secret")
	}
}

func hmacHelper(secret, data string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}
