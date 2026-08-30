// SPDX-License-Identifier: MIT
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { axe, toHaveNoViolations } from "jest-axe";
import { expect, it, describe, vi } from "vitest";

expect.extend(toHaveNoViolations);

function TestComponent() {
  const { success, error, info, warning } = useToast();
  return (
    <div>
      <button onClick={() => success("Payment sent")}>Success</button>
      <button onClick={() => error("Payment failed")}>Error</button>
      <button onClick={() => info("Update")}>Info</button>
      <button onClick={() => warning("Low balance")}>Warning</button>
    </div>
  );
}

describe("Toast accessibility", () => {
  it("should have no accessibility violations (Axe)", async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    act(() => {
      screen.getByText("Success").click();
      screen.getByText("Error").click();
    });

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });

  it("should announce info/success in the polite region and error in the assertive region", () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    act(() => {
      screen.getByText("Success").click();
    });

    const politeRegion = screen.getByRole("status");
    expect(politeRegion).toHaveAttribute("aria-live", "polite");
    expect(politeRegion).toHaveTextContent("Payment sent");

    act(() => {
      screen.getByText("Error").click();
    });

    const assertiveRegion = screen.getByRole("alert");
    expect(assertiveRegion).toHaveAttribute("aria-live", "assertive");
    expect(assertiveRegion).toHaveTextContent("Payment failed");
  });
});
