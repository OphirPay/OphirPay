// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  Breadcrumb,
  breadcrumbItemsFromPath,
  formatSegmentLabel,
} from "@/components/Breadcrumb";

const HEX_ID = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const G_ADDRESS = "G" + "A".repeat(55);

beforeEach(() => {
  push.mockClear();
});

describe("formatSegmentLabel", () => {
  it("formats a slug into title case", () => {
    expect(formatSegmentLabel("batch-payouts")).toBe("Batch Payouts");
  });

  it("decodes URI-encoded segments (%20 becomes a space)", () => {
    expect(formatSegmentLabel("batch%20payouts")).toBe("Batch Payouts");
  });

  it("handles a URI-encoded slug", () => {
    expect(formatSegmentLabel(encodeURIComponent("batch-payouts"))).toBe("Batch Payouts");
  });

  it("converts underscores to spaces", () => {
    expect(formatSegmentLabel("audit_log")).toBe("Audit Log");
  });

  it("keeps the rest of each word's casing intact", () => {
    expect(formatSegmentLabel("usdc-payments")).toBe("Usdc Payments");
    expect(formatSegmentLabel("API-keys")).toBe("API Keys");
  });

  it("falls back to the raw segment on malformed escapes", () => {
    expect(formatSegmentLabel("100%")).toBe("100%");
  });

  it("shortens long hex hash IDs instead of title-casing them", () => {
    expect(formatSegmentLabel(HEX_ID)).toBe("9f86d0…0a08");
  });

  it("shortens 0x-prefixed hex IDs", () => {
    expect(formatSegmentLabel("0x" + HEX_ID.slice(0, 40))).toBe("0x9f86…4f1b");
  });

  it("shortens Stellar addresses", () => {
    expect(formatSegmentLabel(G_ADDRESS)).toBe("GAAAAA…AAAA");
  });

  it("title-cases short hex-like words rather than treating them as IDs", () => {
    expect(formatSegmentLabel("beef")).toBe("Beef");
  });
});

describe("breadcrumbItemsFromPath", () => {
  it("builds cumulative hrefs and leaves the last item unlinked", () => {
    expect(breadcrumbItemsFromPath("/batches/batch-payouts/details")).toEqual([
      { label: "Batches", href: "/batches" },
      { label: "Batch Payouts", href: "/batches/batch-payouts" },
      { label: "Details", href: undefined },
    ]);
  });

  it("keeps encoded segments in hrefs but decodes them in labels", () => {
    expect(breadcrumbItemsFromPath("/batches/batch%20payouts/edit")[1]).toEqual({
      label: "Batch Payouts",
      href: "/batches/batch%20payouts",
    });
  });

  it("ignores trailing slashes, query strings and hashes", () => {
    expect(breadcrumbItemsFromPath("/batches/?page=2#top")).toEqual([
      { label: "Batches", href: undefined },
    ]);
  });

  it("returns no items for the root path", () => {
    expect(breadcrumbItemsFromPath("/")).toEqual([]);
  });
});

describe("Breadcrumb component (path mode)", () => {
  it("renders 'batch-payouts' as 'Batch Payouts'", () => {
    render(<Breadcrumb path="/batch-payouts" />);
    expect(screen.getByText("Batch Payouts")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("renders URI-encoded segments as readable text", () => {
    render(<Breadcrumb path="/batches/batch%20payouts/summary" />);
    expect(screen.getByText("Batch Payouts")).toBeTruthy();
    expect(screen.getByText("Summary")).toBeTruthy();
  });

  it("renders dynamic hash IDs in shortened form", () => {
    render(<Breadcrumb path={`/batches/${HEX_ID}`} />);
    expect(screen.getByText("9f86d0…0a08")).toBeTruthy();
    expect(screen.queryByText(HEX_ID)).toBeNull();
  });

  it("renders the current (last) segment as plain text, not a link", () => {
    render(<Breadcrumb path="/batches/batch-payouts" />);
    expect(screen.getByText("Batch Payouts").closest("a")).toBeNull();
    expect(screen.getByText("Batches").closest("a")).not.toBeNull();
  });

  it("calls router.push when an intermediate segment is clicked", () => {
    render(<Breadcrumb path="/batches/batch-payouts/summary" />);
    fireEvent.click(screen.getByText("Batch Payouts"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/batches/batch-payouts");
  });

  it("calls router.push for the Home crumb", () => {
    render(<Breadcrumb path="/batches" />);
    fireEvent.click(screen.getByText("Home"));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("does not hijack modified clicks (open in new tab)", () => {
    render(<Breadcrumb path="/batches/batch-payouts" />);
    fireEvent.click(screen.getByText("Batches"), { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Breadcrumb component (items mode)", () => {
  it("still renders explicit items without using the router", () => {
    render(<Breadcrumb items={[{ label: "Batches", href: "/batches" }, { label: "New" }]} />);
    expect(screen.getByText("Batches")).toBeTruthy();
    fireEvent.click(screen.getByText("Batches"));
    expect(push).not.toHaveBeenCalled();
  });
});
