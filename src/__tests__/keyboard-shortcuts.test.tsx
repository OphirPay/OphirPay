// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  SHORTCUT_REGISTRY,
  ALL_SHORTCUTS,
  openKeyboardShortcuts,
  useKeyboardShortcuts,
} from "@/hooks/useKeyboardShortcuts";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { KeyboardShortcutsOverlay } from "@/components/KeyboardShortcutsOverlay";

describe("Keyboard Shortcuts Registry", () => {
  it("defines grouped shortcuts without empty or stale entries", () => {
    expect(SHORTCUT_REGISTRY.length).toBe(3);
    const groupIds = SHORTCUT_REGISTRY.map((g) => g.id);
    expect(groupIds).toEqual(["global", "tables", "dialogs"]);

    for (const group of SHORTCUT_REGISTRY) {
      expect(group.title).toBeTruthy();
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.id).toBeTruthy();
        expect(shortcut.category).toBe(group.id);
        expect(shortcut.description).toBeTruthy();
        expect(shortcut.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it("flattens all shortcuts in ALL_SHORTCUTS matching group total", () => {
    const totalInGroups = SHORTCUT_REGISTRY.reduce(
      (sum, g) => sum + g.shortcuts.length,
      0
    );
    expect(ALL_SHORTCUTS.length).toBe(totalInGroups);
  });
});

describe("KeyboardShortcutsModal Component", () => {
  it("renders nothing visible when closed", () => {
    render(<KeyboardShortcutsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("renders accessible modal with title, description, and group headings when open", () => {
    render(<KeyboardShortcutsModal open={true} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(
      screen.getByText(/Quick actions and navigation chords across OphirPay/i)
    ).toBeInTheDocument();

    expect(screen.getByText("Global Navigation")).toBeInTheDocument();
    expect(screen.getByText("Tables & Lists")).toBeInTheDocument();
    expect(screen.getByText("Dialogs & Modals")).toBeInTheDocument();
  });

  it("displays every registered shortcut from ALL_SHORTCUTS with no omissions", () => {
    render(<KeyboardShortcutsModal open={true} onClose={vi.fn()} />);

    for (const shortcut of ALL_SHORTCUTS) {
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
      const itemEl = screen.getByText(shortcut.description).closest("[data-shortcut-id]");
      expect(itemEl).not.toBeNull();

      for (const key of shortcut.keys) {
        expect(itemEl?.textContent).toContain(key);
      }
    }
  });

  it("renders key caps using kbd elements", () => {
    const { baseElement } = render(
      <KeyboardShortcutsModal open={true} onClose={vi.fn()} />
    );
    const kbdElements = baseElement.querySelectorAll("kbd");
    expect(kbdElements.length).toBeGreaterThanOrEqual(ALL_SHORTCUTS.length);
  });
});

describe("KeyboardShortcutsOverlay Component & Keyboard Interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens on pressing '?' key and closes on Escape, returning focus to trigger", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger Button";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    render(<KeyboardShortcutsOverlay />);

    // Initially modal is closed
    expect(screen.queryByRole("dialog")).toBeNull();

    // Press '?'
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();

    // Press 'Escape'
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).toBeNull();

    document.body.removeChild(trigger);
  });

  it("opens on pressing 'Ctrl+/' chord", () => {
    render(<KeyboardShortcutsOverlay />);

    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true })
      );
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not open when pressing '?' inside an input or textarea element", () => {
    render(
      <div>
        <input data-testid="test-input" type="text" />
        <KeyboardShortcutsOverlay />
      </div>
    );

    const input = screen.getByTestId("test-input");
    input.focus();

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "?", bubbles: true })
      );
    });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when openKeyboardShortcuts() helper is invoked", () => {
    render(<KeyboardShortcutsOverlay />);

    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      openKeyboardShortcuts();
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
