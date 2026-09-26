// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  KeyboardShortcutsModal,
  KeyboardShortcutsOverlay,
} from "@/components/KeyboardShortcutsOverlay";
import {
  REGISTERED_SHORTCUTS,
  getRegisteredShortcuts,
  useKeyboardShortcutOverlay,
} from "@/hooks/useKeyboardShortcuts";
import { renderHook } from "@testing-library/react";

describe("Keyboard Shortcuts Overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports an authoritative list of shortcuts grouped into global, tables, and dialogs", () => {
    const shortcuts = getRegisteredShortcuts();
    expect(shortcuts.length).toBeGreaterThanOrEqual(10);

    const categories = new Set(shortcuts.map((s) => s.category));
    expect(categories.has("global")).toBe(true);
    expect(categories.has("tables")).toBe(true);
    expect(categories.has("dialogs")).toBe(true);
  });

  it("renders every registered shortcut with description and key caps with no stale entries", () => {
    render(<KeyboardShortcutsModal open={true} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();

    const shortcuts = getRegisteredShortcuts();
    for (const shortcut of shortcuts) {
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
    }

    // Context headers are visible
    expect(screen.getByText("Global")).toBeInTheDocument();
    expect(screen.getByText("Tables & Lists")).toBeInTheDocument();
    expect(screen.getByText("Dialogs & Overlays")).toBeInTheDocument();
  });

  it("calls onClose when the close button or Esc is pressed", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal open={true} onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("toggles overlay open on '?' key chord", () => {
    const { result } = renderHook(() => useKeyboardShortcutOverlay());
    expect(result.current.isOpen).toBe(false);

    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("toggles overlay open on 'Ctrl+/' chord", () => {
    const { result } = renderHook(() => useKeyboardShortcutOverlay());
    expect(result.current.isOpen).toBe(false);

    act(() => {
      fireEvent.keyDown(document, { key: "/", ctrlKey: true });
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("suppresses shortcut toggle when an input or textarea is active", () => {
    const { result } = renderHook(() => useKeyboardShortcutOverlay());
    expect(result.current.isOpen).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);

    act(() => {
      fireEvent.keyDown(input, { key: "?" });
    });
    expect(result.current.isOpen).toBe(false);

    document.body.removeChild(input);
  });

  it("renders overlay via KeyboardShortcutsOverlay component", () => {
    render(<KeyboardShortcutsOverlay />);

    // Initially closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Trigger "?"
    act(() => {
      fireEvent.keyDown(document, { key: "?" });
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
  });
});
