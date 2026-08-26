// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Modal } from "@/components/ui/Modal";
import { ToastProvider, useToast } from "@/components/ui/Toast";

describe("Spinner", () => {
  it("renders a loading indicator with an accessible label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("applies size classes", () => {
    render(<Spinner size="lg" />);
    expect(screen.getByRole("status").getAttribute("class")).toContain("h-8 w-8");
  });
});

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Send Payment</Button>);
    expect(screen.getByRole("button", { name: /send payment/i })).toBeInTheDocument();
  });

  it("shows a spinner and disables while loading", () => {
    render(<Button loading>Send</Button>);
    const button = screen.getByRole("button", { name: /send/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").className).toContain("bg-red-600");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Badge", () => {
  it("renders label with a status dot", () => {
    render(<Badge variant="success" dot>RECORDED</Badge>);
    const badge = screen.getByText("RECORDED");
    expect(badge.className).toContain("bg-green-100");
  });

  it("renders without a dot by default", () => {
    const { container } = render(<Badge>INFO</Badge>);
    expect(container.querySelector(".bg-gray-400")).toBeNull();
  });

  it("uses WCAG AA-contrast text colors", () => {
    render(<Badge variant="warning">PENDING</Badge>);
    expect(screen.getByText("PENDING").className).toContain("text-yellow-800");
  });
});

describe("StatusBadge", () => {
  it("derives green styling for COMPLETED", () => {
    render(<StatusBadge status="COMPLETED" />);
    const badge = screen.getByText("COMPLETED");
    expect(badge.className).toContain("green");
  });

  it("derives red styling for FAILED", () => {
    render(<StatusBadge status="FAILED" />);
    const badge = screen.getByText("FAILED");
    expect(badge.className).toContain("red");
  });

  it("humanizes snake_case statuses", () => {
    render(<StatusBadge status="PARTIALLY_COMPLETED" />);
    expect(screen.getByText("PARTIALLY COMPLETED")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("copies the value and shows Copied confirmation", async () => {
    render(<CopyButton value="GABCDEF123" label="Address" />);
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("GABCDEF123");
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}}>Content</Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders title and content when open", () => {
    render(
      <Modal open onClose={() => {}} title="Confirm">
        <p>Are you sure?</p>
      </Modal>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Content</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("pushes a history entry so the back button can close it", () => {
    render(<Modal open onClose={() => {}}>Content</Modal>);
    expect(window.history.state?.ophirPayModal).toBe(true);
  });

  it("closes when the browser back button is pressed", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Content</Modal>);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("Toast system", () => {
  function ToastTrigger() {
    const toast = useToast();
    return (
      <button onClick={() => toast.success("Payment sent", "500 XLM → GABC...")}>
        Trigger
      </button>
    );
  }

  it("throws when useToast is used outside provider", () => {
    expect(() => render(<ToastTrigger />)).toThrow(
      /useToast must be used within a ToastProvider/
    );
  });

  it("shows a success toast with title and description", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /trigger/i }));
    expect(screen.getByText("Payment sent")).toBeInTheDocument();
    expect(screen.getByText("500 XLM → GABC...")).toBeInTheDocument();
  });
});
