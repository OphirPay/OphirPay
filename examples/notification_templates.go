// Slack & Discord notification templates for payment events (#816)
package ophirpay

import (
	"encoding/json"
	"fmt"
)

type NotificationPayload struct {
	PaymentID string  `json:"payment_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
	Status    string  `json:"status"`
}

func FormatSlackNotification(p NotificationPayload) ([]byte, error) {
	msg := map[string]interface{}{
		"text": fmt.Sprintf("💳 *Payment Notification*: Payment `%s` of %.2f %s is now *%s*", p.PaymentID, p.Amount, p.Currency, p.Status),
	}
	return json.Marshal(msg)
}

func FormatDiscordNotification(p NotificationPayload) ([]byte, error) {
	msg := map[string]interface{}{
		"content": fmt.Sprintf("🔔 **OphirPay Alert**: Payment `%s` (%.2f %s) -> Status: %s", p.PaymentID, p.Amount, p.Currency, p.Status),
	}
	return json.Marshal(msg)
}
