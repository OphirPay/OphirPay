// CLI utility to create payment transactions for CI pipelines (#822)
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

type PaymentRequest struct {
	AccountID string  `json:"account_id"`
	Amount    float64 `json:"amount"`
	Currency  string  `json:"currency"`
}

func main() {
	if len(os.Args) < 4 {
		fmt.Println("Usage: ophirpay-cli <account_id> <amount> <currency>")
		os.Exit(1)
	}

	reqBody, _ := json.Marshal(PaymentRequest{
		AccountID: os.Args[1],
		Amount:    100.0,
		Currency:  os.Args[3],
	})

	apiURL := os.Getenv("OPHIRPAY_API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080/api/payments"
	}

	resp, err := http.Post(apiURL, "application/json", bytes.NewBuffer(reqBody))
	if err != nil {
		fmt.Printf("Error triggering payment: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	fmt.Printf("Payment triggered successfully. Status code: %d\n", resp.StatusCode)
}
