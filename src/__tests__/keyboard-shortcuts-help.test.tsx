// SPDX-License-Identifier: MIT

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";

describe("KeyboardShortcutsHelp", () => {
  it("opens and closes with the global shortcut while ignoring text input", () => {
    render(<><input aria-label="Search" /><KeyboardShortcutsHelp /></>);
    const input = screen.getByRole("textbox", { name: "Search" });
    input.focus();
    fireEvent.keyDown(input, { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    input.blur();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a discoverable list of supported keyboard shortcuts", () => {
    render(<KeyboardShortcutsHelp />);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeDefined();
    expect(screen.getByText("Open one of the first nine sidebar sections")).toBeDefined();
    expect(screen.getByText("Move between payment rows")).toBeDefined();
    expect(screen.getByText("Close an open dialog or menu")).toBeDefined();
    expect(screen.getByText(/Command works in place of Ctrl/)).toBeDefined();
  });
});
