// SPDX-License-Identifier: MIT

import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SudoReauthModal } from "@/components/SudoReauthModal";

const SUDO_TTL_MS = 15 * 60 * 1000;

function Harness({ onExpire }: { onExpire: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <SudoReauthModal
      open={open}
      onConfirm={() => {}}
      onCancel={() => setOpen(false)}
      sessionTtlMs={SUDO_TTL_MS}
      onSessionExpire={() => {
        onExpire();
        setOpen(false);
      }}
    />
  );
}

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("SudoReauthModal session countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 15:00 when mounted with an active sudo session", () => {
    render(<Harness onExpire={vi.fn()} />);
    expect(screen.getByTestId("sudo-countdown").textContent).toBe(
      "Sudo session expires in 15:00"
    );
  });

  it("decrements every second", () => {
    render(<Harness onExpire={vi.fn()} />);
    advance(1000);
    expect(screen.getByTestId("sudo-countdown").textContent).toBe(
      "Sudo session expires in 14:59"
    );
    advance(1000);
    expect(screen.getByTestId("sudo-countdown").textContent).toBe(
      "Sudo session expires in 14:58"
    );
    advance(58_000);
    expect(screen.getByTestId("sudo-countdown").textContent).toBe(
      "Sudo session expires in 14:00"
    );
  });

  it("does not expire before 15 minutes have elapsed", () => {
    const onExpire = vi.fn();
    render(<Harness onExpire={onExpire} />);
    advance(SUDO_TTL_MS - 1000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(screen.getByTestId("sudo-countdown").textContent).toBe(
      "Sudo session expires in 00:01"
    );
  });

  it("expires after 15 minutes, fires onSessionExpire once and resets the modal", () => {
    const onExpire = vi.fn();
    render(<Harness onExpire={onExpire} />);
    advance(SUDO_TTL_MS);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sudo-countdown")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    // No further expiry callbacks once the countdown has been torn down.
    advance(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("shows an expired message when the host keeps the modal open", () => {
    const onExpire = vi.fn();
    render(
      <SudoReauthModal
        open
        onConfirm={() => {}}
        onCancel={() => {}}
        sessionTtlMs={5000}
        onSessionExpire={onExpire}
      />
    );
    advance(5000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sudo-countdown").textContent).toBe("Sudo session expired");
  });

  it("renders no countdown when no session TTL is provided", () => {
    render(<SudoReauthModal open onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByTestId("sudo-countdown")).toBeNull();
  });
});
