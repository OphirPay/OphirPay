// SPDX-License-Identifier: MIT

import { fireEvent,render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AssetSelector, filterAssets } from "@/components/AssetSelector";
import type { AssetInfo } from "@/lib/assets";

// ── Mocks ──────────────────────────────────────────────────────
// Keep the component hermetic: no Horizon, no TOML resolution, no wallet modal.

const { fetchAllBalancesMock } = vi.hoisted(() => ({
  fetchAllBalancesMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/stellar", () => ({
  STELLAR_NETWORK: "TESTNET",
  fetchAllBalances: fetchAllBalancesMock,
}));

vi.mock("@/lib/trustline", () => ({
  checkTrustline: vi
    .fn()
    .mockResolvedValue({ hasTrustline: true, state: "authorized" }),
  getTrustlineMessage: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/asset-metadata-client", () => ({
  fetchAssetMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/wallet/TrustlineModal", () => ({
  TrustlineModal: () => null,
}));

// ── Fixtures ───────────────────────────────────────────────────

/** A well-formed-looking issuer whose body is unique per `seed` character. */
const issuerOf = (seed: string) => `G${seed.repeat(55)}`;

const asset = (
  code: string,
  displayName: string,
  seed: string,
): AssetInfo => ({
  code,
  issuer: issuerOf(seed),
  type: "credit_alphanum4",
  displayName,
  decimals: 7,
});

const XLM: AssetInfo = {
  code: "XLM",
  type: "native",
  displayName: "Stellar Lumens",
  decimals: 7,
};

/** Ten assets; exactly one has the code `USDC`, each issuer is distinct. */
const ASSETS: AssetInfo[] = [
  XLM,
  asset("USDC", "USD Coin", "A"),
  asset("EURC", "Euro Coin", "B"),
  asset("BTC", "Wrapped Bitcoin", "C"),
  asset("ETH", "Wrapped Ether", "D"),
  asset("AQUA", "Aquarius", "E"),
  asset("YXLM", "Yield Lumens", "F"),
  asset("SHX", "Stronghold", "H"),
  asset("VELO", "Velo", "J"),
  asset("MOBI", "Mobius", "K"),
];

function renderOpen() {
  render(
    <AssetSelector
      publicKey={null}
      selectedAsset={XLM}
      onSelect={vi.fn()}
      assets={ASSETS}
    />,
  );
  // The trigger is the only button before the dropdown opens.
  fireEvent.click(screen.getByRole("button"));
  return screen.getByLabelText("Search assets");
}

const optionCodes = () =>
  screen
    .queryAllByTestId("asset-option")
    .map((el) => el.querySelector("span.font-medium")?.textContent);

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

describe("AssetSelector search", () => {
  it("lists all ten assets when the query is empty", () => {
    renderOpen();
    expect(screen.getAllByTestId("asset-option")).toHaveLength(10);
  });

  it("filters by asset code and shows only the matching asset", () => {
    const search = renderOpen();

    fireEvent.change(search, { target: { value: "USDC" } });

    expect(optionCodes()).toEqual(["USDC"]);
    expect(screen.queryByText("No assets found")).not.toBeInTheDocument();
  });

  it("matches the asset code case-insensitively", () => {
    const search = renderOpen();

    fireEvent.change(search, { target: { value: "usdc" } });

    expect(optionCodes()).toEqual(["USDC"]);
  });

  it("matches a partial issuer address", () => {
    const search = renderOpen();

    // A fragment from the middle of EURC's issuer (seed "B").
    fireEvent.change(search, { target: { value: "BBBBBBBB" } });

    expect(optionCodes()).toEqual(["EURC"]);
  });

  it("matches the full issuer address", () => {
    const search = renderOpen();

    fireEvent.change(search, { target: { value: issuerOf("D") } });

    expect(optionCodes()).toEqual(["ETH"]);
  });

  it("shows 'No assets found' when nothing matches", () => {
    const search = renderOpen();

    fireEvent.change(search, { target: { value: "ZZZZ-NOPE" } });

    expect(screen.queryAllByTestId("asset-option")).toHaveLength(0);
    expect(screen.getByText("No assets found")).toBeInTheDocument();
  });

  it("restores the full list when the query is cleared", () => {
    const search = renderOpen();

    fireEvent.change(search, { target: { value: "USDC" } });
    fireEvent.change(search, { target: { value: "" } });

    expect(screen.getAllByTestId("asset-option")).toHaveLength(10);
    expect(screen.queryByText("No assets found")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pure filter
// ═══════════════════════════════════════════════════════════════

describe("filterAssets", () => {
  it("returns every asset for a blank or whitespace query", () => {
    expect(filterAssets(ASSETS, "")).toHaveLength(10);
    expect(filterAssets(ASSETS, "   ")).toHaveLength(10);
  });

  it("matches by display label", () => {
    expect(filterAssets(ASSETS, "aquarius").map((a) => a.code)).toEqual([
      "AQUA",
    ]);
  });

  it("does not match the native asset on a missing issuer", () => {
    expect(filterAssets([XLM], "undefined")).toEqual([]);
  });
});
