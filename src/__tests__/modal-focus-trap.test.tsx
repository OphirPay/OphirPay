// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

function renderDialog(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  return render(
    <Modal {...props}>
      {props.children ?? (
        <div>
          <button type="button">First</button>
          <button type="button">Last</button>
        </div>
      )}
    </Modal>,
  );
}

describe("Modal focus containment (issue #1383)", () => {
  it("is exposed as a modal dialog named by its rendered heading", () => {
    renderDialog({ open: true, onClose: vi.fn(), title: "Confirm transfer" });

    const dialog = screen.getByRole("dialog", { name: "Confirm transfer" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // The name comes from the heading (aria-labelledby), not a duplicate aria-label.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent(
      "Confirm transfer",
    );
    expect(dialog).not.toHaveAttribute("aria-label");
  });

  it("describes the dialog with its description text", () => {
    renderDialog({
      open: true,
      onClose: vi.fn(),
      title: "Confirm transfer",
      description: "This moves funds immediately.",
    });

    const dialog = screen.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "This moves funds immediately.",
    );
  });

  it("still gives a titleless dialog an accessible name", () => {
    renderDialog({ open: true, onClose: vi.fn() });
    expect(screen.getByRole("dialog", { name: "Dialog" })).toBeDefined();
  });

  it("moves focus into the dialog when it opens", () => {
    renderDialog({ open: true, onClose: vi.fn(), title: "Confirm transfer" });

    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab from the last control back to the first", () => {
    renderDialog({ open: true, onClose: vi.fn(), title: "Confirm transfer" });

    const dialog = screen.getByRole("dialog");
    const [closeButton] = Array.from(
      dialog.querySelectorAll<HTMLElement>("button"),
    );
    const buttons = screen.getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    expect(closeButton).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toBe(document.activeElement);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    renderDialog({ open: true, onClose: vi.fn(), title: "Confirm transfer" });

    const buttons = screen.getAllByRole("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toBe(document.activeElement);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDialog({ open: true, onClose, title: "Confirm transfer" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger when it closes", () => {
    render(
      <>
        <button type="button">Open</button>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();

    const { rerender } = render(
      <Modal open={true} onClose={vi.fn()} title="Confirm transfer">
        <button type="button">Inside</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Inside" })).toBeDefined();

    rerender(
      <Modal open={false} onClose={vi.fn()} title="Confirm transfer">
        <button type="button">Inside</button>
      </Modal>,
    );

    expect(trigger).toBe(document.activeElement);
  });
});

describe("ConfirmDialog inherits focus containment (issue #1383)", () => {
  it("traps focus, closes on Escape and restores focus", () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Open delete dialog";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={vi.fn()}
        title="Delete payment?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep"
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Delete payment?" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    const confirmButton = screen.getByRole("button", { name: "Delete" });
    confirmButton.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    // Tab from the last control (Cancel is after Delete) wraps to the first.
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    unmount();
    expect(trigger).toBe(document.activeElement);
    trigger.remove();
  });
});
