// SPDX-License-Identifier: MIT

import { fireEvent,render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/components/EmptyState";

const baseProps = {
  icon: <span data-testid="empty-icon">📭</span>,
  title: "No payments yet",
  description: "Payments you send will show up here.",
};

describe("EmptyState — with a CTA action", () => {
  it("renders the title, description, icon and the action button", () => {
    render(
      <EmptyState
        {...baseProps}
        actionLabel="Send a payment"
        onAction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No payments yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Payments you send will show up here."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send a payment" }),
    ).toBeInTheDocument();
  });

  it("calls onAction when the action button is clicked", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        {...baseProps}
        actionLabel="Send a payment"
        onAction={onAction}
      />,
    );

    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send a payment" }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("calls onAction once per click", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        {...baseProps}
        actionLabel="Send a payment"
        onAction={onAction}
      />,
    );
    const button = screen.getByRole("button", { name: "Send a payment" });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onAction).toHaveBeenCalledTimes(3);
  });

  it("renders a default plus icon when no actionIcon is given", () => {
    render(
      <EmptyState
        {...baseProps}
        actionLabel="Send a payment"
        onAction={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Send a payment" });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("renders a custom actionIcon inside the button instead of the default", () => {
    render(
      <EmptyState
        {...baseProps}
        actionLabel="Enable live"
        actionIcon={<span data-testid="custom-action-icon">▶</span>}
        onAction={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /enable live/i });
    expect(button).toContainElement(screen.getByTestId("custom-action-icon"));
    expect(button.querySelector("svg")).toBeNull();
  });

  it("does not submit an enclosing form (button type is 'button')", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <EmptyState
          {...baseProps}
          actionLabel="Send a payment"
          onAction={vi.fn()}
        />
      </form>,
    );

    const button = screen.getByRole("button", { name: "Send a payment" });
    expect(button).toHaveAttribute("type", "button");

    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("EmptyState — without a CTA action", () => {
  it("still renders the title, description and icon", () => {
    render(<EmptyState {...baseProps} />);

    expect(
      screen.getByRole("heading", { name: "No payments yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Payments you send will show up here."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
  });

  it("mounts no button element when no action props are provided", () => {
    const { container } = render(<EmptyState {...baseProps} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });

  it("mounts no button when only actionLabel is provided (no handler)", () => {
    const { container } = render(
      <EmptyState {...baseProps} actionLabel="Send a payment" />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
    expect(screen.queryByText("Send a payment")).not.toBeInTheDocument();
  });
});

describe("EmptyState — className", () => {
  it("merges a custom className onto the container", () => {
    const { container } = render(
      <EmptyState {...baseProps} className="my-custom-class" />,
    );

    expect(container.firstElementChild).toHaveClass("my-custom-class");
    // Base styling is kept alongside the custom class.
    expect(container.firstElementChild).toHaveClass("text-center");
  });
});
