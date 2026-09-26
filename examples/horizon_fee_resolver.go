// Horizon fee statistics recommendation helper (#825)
package ophirpay

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
)

type FeeStats struct {
	LastLedger          string `json:"last_ledger"`
	LastLedgerBaseFee   string `json:"last_ledger_base_fee"`
	P10Fee              string `json:"p10_accepted_fee"`
	P50Fee              string `json:"p50_accepted_fee"`
	P90Fee              string `json:"p90_accepted_fee"`
}

type HorizonFeeResolver struct {
	HorizonURL string
}

func NewHorizonFeeResolver(url string) *HorizonFeeResolver {
	return &HorizonFeeResolver{HorizonURL: url}
}

func (r *HorizonFeeResolver) RecommendTransactionFee(ctx context.Context) (uint32, error) {
	resp, err := http.Get(r.HorizonURL + "/fee_stats")
	if err != nil {
		return 100, nil // Fallback base fee
	}
	defer resp.Body.Close()

	var stats FeeStats
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return 100, nil
	}

	fee, err := strconv.ParseUint(stats.P50Fee, 10, 32)
	if err != nil {
		return 100, nil
	}
	return uint32(fee), nil
}
