// Asset metadata resolver for displaying ticker and issuer name (#824)
package ophirpay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type AssetMetadata struct {
	AssetCode   string `json:"asset_code"`
	AssetIssuer string `json:"asset_issuer"`
	Name        string `json:"name"`
	Decimals    int    `json:"decimals"`
}

type AssetMetadataResolver struct {
	HorizonURL string
}

func NewAssetMetadataResolver(url string) *AssetMetadataResolver {
	return &AssetMetadataResolver{HorizonURL: url}
}

func (r *AssetMetadataResolver) LookupAsset(ctx context.Context, code, issuer string) (*AssetMetadata, error) {
	if code == "XLM" || issuer == "" {
		return &AssetMetadata{AssetCode: "XLM", Name: "Stellar Lumens", Decimals: 7}, nil
	}

	reqURL := fmt.Sprintf("%s/assets?asset_code=%s&asset_issuer=%s", r.HorizonURL, code, issuer)
	resp, err := http.Get(reqURL)
	if err != nil {
		return &AssetMetadata{AssetCode: code, AssetIssuer: issuer, Name: code, Decimals: 7}, nil
	}
	defer resp.Body.Close()

	var result struct {
		Embedded struct {
			Records []AssetMetadata `json:"records"`
		} `json:"_embedded"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err == nil && len(result.Embedded.Records) > 0 {
		return &result.Embedded.Records[0], nil
	}

	return &AssetMetadata{AssetCode: code, AssetIssuer: issuer, Name: code, Decimals: 7}, nil
}
