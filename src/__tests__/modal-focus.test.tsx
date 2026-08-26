// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState, useRef } from "react";
import { Modal } from "@/components/ui/Modal";

function ModalTestHost({
  defaultOpen = false,
  withCustomRef = false,
}: {
  defaultOpen?: boolean;
  withCustomRef?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <button data-testid="trigger-btn" onClick={() => setOpen(true)}>
        Open Dialog
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Settings Dialog"
        description="Configure your preferences"
        initialFocusRef={withCustomRef ? inputRef : undefined}
      >
        <div>
          <input
            data-testid="first-input"
            ref={inputRef}
            placeholder="Username"
          />
          <button data-testid="action-btn">Save Changes</button>
        </div>
      </Modal>
    </div>
  );
}

describe("Modal Focus Management", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lands initial focus on the first interactive element when opened", async () => {
    render(<ModalTestHost defaultOpen={false} />);
    const trigger = screen.getByTestId("trigger-btn");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    act(() => {
      vi.runAllTimers();
    });

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("lands initial focus on custom initialFocusRef when provided", async () => {
    render(<ModalTestHost defaultOpen={false} withCustomRef={true} />);
    const trigger = screen.getByTestId("trigger-btn");
    trigger.focus();

    fireEvent.click(trigger);

    act(() => {
      vi.runAllTimers();
    });

    const firstInput = screen.getByTestId("first-input");
    expect(document.activeElement).toBe(firstInput);
  });

  it("traps focus and wraps from last interactive element to first on Tab", async () => {
    render(<ModalTestHost defaultOpen={true} />);

    act(() => {
      vi.runAllTimers();
    });

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    const actionBtn = screen.getByTestId("action-btn");

    actionBtn.focus();
    expect(document.activeElement).toBe(actionBtn);

    // Press Tab on last element
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("traps focus and wraps from first interactive element to last on Shift+Tab", async () => {
    render(<ModalTestHost defaultOpen={true} />);

    act(() => {
      vi.runAllTimers();
    });

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    const actionBtn = screen.getByTestId("action-btn");

    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Press Shift+Tab on first element
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(actionBtn);
  });

  it("restores focus to the trigger element when the modal is closed", async () => {
    render(<ModalTestHost defaultOpen={false} />);
    const trigger = screen.getByTestId("trigger-btn");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open
    fireEvent.click(trigger);

    act(() => {
      vi.runAllTimers();
    });

    const closeBtn = screen.getByRole("button", { name: "Close dialog" });
    expect(document.activeElement).toBe(closeBtn);

    // Close via close button
    fireEvent.click(closeBtn);

    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to trigger when closed via Escape key", async () => {
    render(<ModalTestHost defaultOpen={false} />);
    const trigger = screen.getByTestId("trigger-btn");
    trigger.focus();

    fireEvent.click(trigger);

    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Close via Escape
    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.activeElement).toBe(trigger);
  });
});
