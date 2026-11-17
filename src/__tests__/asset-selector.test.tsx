// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { USDC_TESTNET } from "@/lib/assets";

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


describe("AssetSelector Accessibility & Keyboard Navigation (Issue #1893)", () => {
  const onSelectMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders trigger button with trigger accessibility attributes", () => {
    render(
      <AssetSelector
        publicKey="GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4"
        selectedAsset={XLM}
        onSelect={onSelectMock}
      />
    );

    const trigger = screen.getByRole("button", { name: /Select asset/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("XLM")
    );
  });

  it("opens listbox with role='listbox' and options with role='option'", () => {
    render(
      <AssetSelector
        publicKey="GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4"
        selectedAsset={XLM}
        onSelect={onSelectMock}
      />
    );

    const trigger = screen.getByRole("button", { name: /Select asset/i });
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(2);

    const xlmOption = options.find((opt) => opt.textContent?.includes("XLM"));
    expect(xlmOption).toHaveAttribute("aria-selected", "true");
  });

  it("navigates options via ArrowDown and ArrowUp keys", () => {
    render(
      <AssetSelector
        publicKey="GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4"
        selectedAsset={XLM}
        onSelect={onSelectMock}
      />
    );

    const trigger = screen.getByRole("button", { name: /Select asset/i });
    // Open via keyboard ArrowDown
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    // Navigate to next item
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveFocus();

    // Navigate back up
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(options[0]).toHaveFocus();
  });

  it("selects asset via Enter key and closes the listbox", async () => {
    render(
      <AssetSelector
        publicKey="GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4"
        selectedAsset={XLM}
        onSelect={onSelectMock}
      />
    );

    const trigger = screen.getByRole("button", { name: /Select asset/i });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    // Focus next asset (USDC)
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    // Press Enter to select
    fireEvent.keyDown(listbox, { key: "Enter" });

    await waitFor(() => {
      expect(onSelectMock).toHaveBeenCalledWith(USDC_TESTNET);
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the listbox and restores focus to trigger when Escape is pressed", () => {
    render(
      <AssetSelector
        publicKey="GWT7SDH7366X75RZDMUOCSWWRJUF3IJKJI4FYHZAEQSPI626PO4LZZF4"
        selectedAsset={XLM}
        onSelect={onSelectMock}
      />
    );

    const trigger = screen.getByRole("button", { name: /Select asset/i });
    fireEvent.click(trigger);

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    fireEvent.keyDown(listbox, { key: "Escape" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});