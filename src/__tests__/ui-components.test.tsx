// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
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

  it("restores focus to the trigger element when closed via Escape", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open modal
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Dialog">
            Content
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /open modal/i });
    trigger.focus();

    fireEvent.click(trigger);
    // Focus moves into the dialog (the inner tabindex=-1 container)
    await waitFor(() =>
      expect(screen.getByRole("dialog").querySelector('[tabindex="-1"]')).toHaveFocus()
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps focus inside the dialog when the onClose identity changes mid-open", async () => {
    // Regression: the production caller (e.g. WalletButton) recreates onClose
    // on connection-state changes. The focus/keydown effect must not tear down
    // and restore focus to the trigger while the dialog remains open.
    function Harness({ onClose }: { onClose: () => void }) {
      return <Modal open onClose={onClose} title="Dialog">Content</Modal>;
    }

    const { rerender } = render(<Harness onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const inner = dialog.querySelector('[tabindex="-1"]') as HTMLElement;
    await waitFor(() => expect(inner).toHaveFocus());

    // Caller re-renders with a brand-new onClose closure — same as when
    // connection state changes in WalletButton.
    rerender(<Harness onClose={() => {}} />);

    expect(inner).toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("restores focus to the trigger element when closed via the close button", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open modal
          </button>
          <Modal open={open} onClose={() => setOpen(false)} title="Dialog">
            Content
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /open modal/i });
    trigger.focus();

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("dialog").querySelector('[tabindex="-1"]')).toHaveFocus()
    );

    fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
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

  it("moves focus to the first interactive element when opened", () => {
    render(
      <Modal open onClose={() => {}}>
        <button>First Action</button>
        <button>Second Action</button>
      </Modal>
    );
    expect(screen.getByRole("button", { name: /first action/i })).toHaveFocus();
  });

  it("cycles focus with Tab and Shift+Tab within the dialog", () => {
    render(
      <Modal open onClose={() => {}}>
        <button>First</button>
        <button>Middle</button>
        <button>Last</button>
      </Modal>
    );
    const first = screen.getByRole("button", { name: "First" });
    const middle = screen.getByRole("button", { name: "Middle" });
    const last = screen.getByRole("button", { name: "Last" });

    // Shift+Tab from the first element wraps to the last
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    // Tab from the last element wraps to the first
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    // Elements between the boundaries receive focus as usual
    expect(middle).toBeInTheDocument();
  });

  it("redirects focus back into the dialog if it escapes", () => {
    render(
      <>
        <button>Outside</button>
        <Modal open onClose={() => {}}>
          <button>Inside</button>
        </Modal>
      </>
    );
    const inside = screen.getByRole("button", { name: "Inside" });
    screen.getByRole("button", { name: "Outside" }).focus();
    expect(inside).toHaveFocus();
  });

  it("restores focus to the trigger element when closed", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open modal</button>
          <Modal open={open} onClose={() => setOpen(false)}>
            <button>Inside</button>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /open modal/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("keeps focus in the dialog when the parent re-renders", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState(0);
      return (
        <>
          <button onClick={() => setOpen(false)}>Close</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Amount">
            <input
              aria-label="Amount input"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("Amount input");
    input.focus();
    fireEvent.change(input, { target: { value: 5 } });
    expect(input).toHaveFocus();
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

  it("uses polite announcements for payment information", () => {
    function InfoTrigger() {
      const toast = useToast();
      return <button onClick={() => toast.info("Payment pending")}>Trigger</button>;
    }

    render(
      <ToastProvider>
        <InfoTrigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /trigger/i }));

    const announcement = screen.getByRole("status");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveTextContent("Payment pending");
  });

  it("uses assertive announcements for payment errors", () => {
    function ErrorTrigger() {
      const toast = useToast();
      return <button onClick={() => toast.error("Transaction failed")}>Trigger</button>;
    }

    render(
      <ToastProvider>
        <ErrorTrigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /trigger/i }));

    const announcement = screen.getByRole("alert");
    expect(announcement).toHaveAttribute("aria-live", "assertive");
    expect(announcement).toHaveTextContent("Transaction failed");
  });

  it("does not replace an announcement region when its parent rerenders", () => {
    function RerenderingTrigger() {
      const toast = useToast();
      const [renderCount, setRenderCount] = useState(0);
      return (
        <>
          <button onClick={() => toast.success("Payment sent")}>Toast</button>
          <button onClick={() => setRenderCount((count) => count + 1)}>
            Rerender {renderCount}
          </button>
        </>
      );
    }

    const { rerender } = render(
      <ToastProvider>
        <RerenderingTrigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Toast" }));
    const announcement = screen.getByRole("status");

    rerender(
      <ToastProvider>
        <RerenderingTrigger />
      </ToastProvider>
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toBe(announcement);
  });
});
