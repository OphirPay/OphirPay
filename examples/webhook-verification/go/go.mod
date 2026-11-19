// SPDX-License-Identifier: MIT
//
// Module file for the Go reference verifier. The verifier is stdlib-only
// (`crypto/hmac`, `crypto/sha256`, `encoding/json`), so no external
// dependencies are required to build or test it:
//
//   go run ./verify.go --secret <secret> --signature <hex> --body-file ../sample-payload.json
//   go test ./
//
// Keeping a go.mod here isolates the example from any other Go modules and
// documents the minimum supported Go version.
module github.com/OphirPay/OphirPay/examples/webhook-verification/go

go 1.21
