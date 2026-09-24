// Anchor SEP-24 deposit & withdrawal flow simulation (#821)
package ophirpay

import (
	"context"
	"errors"
	"time"
)

type AnchorTransaction struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"` // "deposit" or "withdrawal"
	Amount    float64   `json:"amount"`
	AssetCode string    `json:"asset_code"`
	Status    string    `json:"status"` // "pending_user_transfer_start", "completed", "failed"
	CreatedAt time.Time `json:"created_at"`
}

type AnchorClient struct {
	Domain string
}

func NewAnchorClient(domain string) *AnchorClient {
	return &AnchorClient{Domain: domain}
}

func (a *AnchorClient) InitiateDeposit(ctx context.Context, assetCode string, amount float64, accountID string) (*AnchorTransaction, error) {
	if amount <= 0 {
		return nil, errors.New("deposit amount must be greater than zero")
	}
	return &AnchorTransaction{
		ID:        "tx_dep_sep24_" + assetCode,
		Kind:      "deposit",
		Amount:    amount,
		AssetCode: assetCode,
		Status:    "pending_user_transfer_start",
		CreatedAt: time.Now(),
	}, nil
}
