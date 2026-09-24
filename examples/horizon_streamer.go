// Horizon streaming client for payment status updates (#819)
package ophirpay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type PaymentEvent struct {
	ID          string `json:"id"`
	PagingToken string `json:"paging_token"`
	Status      string `json:"status"`
	Amount      string `json:"amount"`
}

type HorizonStreamer struct {
	HorizonURL string
}

func NewHorizonStreamer(url string) *HorizonStreamer {
	return &HorizonStreamer{HorizonURL: url}
}

func (s *HorizonStreamer) StreamPaymentStatus(ctx context.Context, accountID string, eventHandler func(PaymentEvent)) error {
	reqURL := fmt.Sprintf("%s/accounts/%s/payments?cursor=now", s.HorizonURL, accountID)
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	decoder := json.NewDecoder(resp.Body)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			var evt PaymentEvent
			if err := decoder.Decode(&evt); err == nil {
				eventHandler(evt)
			}
		}
	}
}
