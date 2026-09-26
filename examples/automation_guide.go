// Integration guide with generated payload examples for automation platforms (#817)
package ophirpay

import (
	"encoding/json"
	"time"
)

type AutomationPayload struct {
	Event     string                 `json:"event"`
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

func GenerateZapierPayload(paymentID string, amount float64, currency string) ([]byte, error) {
	payload := AutomationPayload{
		Event:     "payment.created",
		Timestamp: time.Now().Unix(),
		Data: map[string]interface{}{
			"payment_id": paymentID,
			"amount":     amount,
			"currency":   currency,
			"status":     "succeeded",
		},
	}
	return json.MarshalIndent(payload, "", "  ")
}
