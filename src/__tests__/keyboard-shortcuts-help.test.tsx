// SPDX-License-Identifier: MIT

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";

describe("KeyboardShortcutsHelp", () => {
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
