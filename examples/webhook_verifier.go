// Go reference implementation for OphirPay Webhook Signature Verification
package ophirpay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidSignature = errors.New("invalid webhook signature")
	ErrExpiredHeader    = errors.New("webhook timestamp is outside tolerance range")
)

// VerifyWebhookSignature verifies the HMAC SHA256 signature of an incoming webhook.
func VerifyWebhookSignature(payload []byte, signatureHeader string, secret string, tolerance time.Duration) bool {
	if signatureHeader == "" || secret == "" {
		return false
	}

	parts := strings.Split(signatureHeader, ",")
	var timestampStr, expectedSig string

	for _, part := range parts {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		if kv[0] == "t" {
			timestampStr = kv[1]
		} else if kv[0] == "v1" {
			expectedSig = kv[1]
		}
	}

	if timestampStr == "" || expectedSig == "" {
		return false
	}

	if tolerance > 0 {
		ts, err := strconv.ParseInt(timestampStr, 10, 64)
		if err != nil {
			return false
		}
		headerTime := time.Unix(ts, 0)
		if time.Since(headerTime) > tolerance || headerTime.Sub(time.Now()) > tolerance {
			return false
		}
	}

	signedPayload := fmt.Sprintf("%s.%s", timestampStr, string(payload))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signedPayload))
	computedSig := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(computedSig), []byte(expectedSig))
}
