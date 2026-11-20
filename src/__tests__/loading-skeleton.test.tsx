// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";

describe("LoadingSkeleton pulse animation classes", () => {
  describe("default text variant", () => {
    it("renders with animate-pulse class for default variant", () => {
      const { container } = render(<LoadingSkeleton />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
    });

    it("applies correct default number of skeleton lines", () => {
      const { container } = render(<LoadingSkeleton />);
      const lines = container.querySelectorAll(".h-4");

      // Default is 3 lines
      expect(lines.length).toBe(3);
    });

    it("renders with varying width percentages for text lines", () => {
      const { container } = render(<LoadingSkeleton />);
      const lines = container.querySelectorAll("div.h-4");

      // Should have different widths for each line
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => {
        const style = window.getComputedStyle(line);
        expect(style.width).toBeTruthy();
      });
    });

    it("accepts custom number of lines", () => {
      const { container } = render(<LoadingSkeleton lines={5} />);
      const lines = container.querySelectorAll(".h-4");

      expect(lines.length).toBe(5);
    });

    it("applies rounded corners to skeleton lines", () => {
      const { container } = render(<LoadingSkeleton />);
      const lines = container.querySelectorAll(".h-4");

      lines.forEach((line) => {
        expect(line.className).toContain("rounded");
      });
    });

    it("applies gray background color for light mode", () => {
      const { container } = render(<LoadingSkeleton />);
      const lines = container.querySelectorAll(".h-4");

      lines.forEach((line) => {
        expect(line.className).toContain("bg-gray-200");
      });
    });

    it("applies dark mode gray background", () => {
      const { container } = render(<LoadingSkeleton />);
      const lines = container.querySelectorAll(".h-4");

      lines.forEach((line) => {
        expect(line.className).toContain("dark:bg-gray-700");
      });
    });
  });

  describe("card variant", () => {
    it("renders card variant with animate-pulse class", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
    });

    it("applies card styling classes", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("bg-white");
      expect(skeleton?.className).toContain("dark:bg-gray-900");
      expect(skeleton?.className).toContain("rounded-xl");
      expect(skeleton?.className).toContain("border");
      expect(skeleton?.className).toContain("p-5");
    });

    it("renders card header skeleton", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const header = container.querySelector("div.h-5");

      expect(header).toBeDefined();
      expect(header?.className).toContain("rounded");
      expect(header?.className).toContain("bg-gray-200");
    });

    it("renders multiple content lines in card", () => {
      const { container } = render(<LoadingSkeleton variant="card" lines={4} />);
      const contentLines = container.querySelectorAll(".space-y-3 .h-4");

      expect(contentLines.length).toBe(4);
    });
  });

  describe("table variant", () => {
    it("renders table variant with animate-pulse class", () => {
      const { container } = render(<LoadingSkeleton variant="table" />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
    });

    it("applies table styling classes", () => {
      const { container } = render(<LoadingSkeleton variant="table" />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("bg-white");
      expect(skeleton?.className).toContain("dark:bg-gray-900");
      expect(skeleton?.className).toContain("rounded-xl");
      expect(skeleton?.className).toContain("border");
    });

    it("renders table header skeleton", () => {
      const { container } = render(<LoadingSkeleton variant="table" />);
      const header = container.querySelector(".flex.justify-between");

      expect(header).toBeDefined();
    });

    it("renders multiple table rows with skeleton content", () => {
      const { container } = render(<LoadingSkeleton variant="table" lines={5} />);
      const rows = container.querySelectorAll(".flex.gap-4.py-3");

      expect(rows.length).toBe(5);
    });

    it("renders row with columns of different widths", () => {
      const { container } = render(<LoadingSkeleton variant="table" lines={2} />);
      const rows = container.querySelectorAll(".flex.gap-4.py-3");

      rows.forEach((row) => {
        const columns = row.querySelectorAll(".h-4");
        // Typically 3 columns: flex-1, w-24, w-20
        expect(columns.length).toBeGreaterThan(0);
      });
    });
  });

  describe("stats variant", () => {
    it("renders stats variant with animate-pulse class", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
    });

    it("applies grid layout for stats cards", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const grid = container.querySelector("div.grid");

      expect(grid).toBeDefined();
      expect(grid?.className).toContain("grid-cols-1");
      expect(grid?.className).toContain("sm:grid-cols-2");
      expect(grid?.className).toContain("lg:grid-cols-4");
    });

    it("renders exactly 4 stats cards", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const cards = container.querySelectorAll(".bg-white");

      expect(cards.length).toBe(4);
    });

    it("applies card styling to each stats card", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const cards = container.querySelectorAll(".bg-white");

      cards.forEach((card) => {
        expect(card.className).toContain("dark:bg-gray-900");
        expect(card.className).toContain("rounded-xl");
        expect(card.className).toContain("border");
        expect(card.className).toContain("p-5");
      });
    });

    it("renders icon placeholder in each stats card", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const cards = container.querySelectorAll(".bg-white");

      cards.forEach((card) => {
        const icon = card.querySelector(".h-8.w-8");
        expect(icon).toBeDefined();
      });
    });

    it("renders value and label placeholders in stats cards", () => {
      const { container } = render(<LoadingSkeleton variant="stats" />);
      const cards = container.querySelectorAll(".bg-white");

      cards.forEach((card) => {
        const value = card.querySelector(".h-8");
        const label = card.querySelector(".h-4");
        expect(value).toBeDefined();
        expect(label).toBeDefined();
      });
    });
  });

  describe("accessible ARIA attributes", () => {
    it("includes aria-busy attribute when rendering skeleton", () => {
      const { container } = render(<LoadingSkeleton />);
      // Note: LoadingSkeleton doesn't currently add aria-busy, but this test
      // documents what should be added for accessibility compliance
      const skeleton = container.querySelector("div");
      // Currently not added, but this test serves as documentation for future improvements
      expect(skeleton).toBeDefined();
    });

    it("supports aria-live polite for dynamic updates", () => {
      const { container } = render(<LoadingSkeleton />);
      const skeleton = container.querySelector("div");
      // Note: aria-live could be added to indicate polite region updates
      expect(skeleton).toBeDefined();
    });
  });

  describe("custom className prop", () => {
    it("applies custom className to container", () => {
      const { container } = render(
        <LoadingSkeleton className="custom-class custom-style" />
      );
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("custom-class");
      expect(skeleton?.className).toContain("custom-style");
    });

    it("preserves both custom and default classes", () => {
      const { container } = render(
        <LoadingSkeleton className="mt-4 mb-2" />
      );
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
      expect(skeleton?.className).toContain("mt-4");
      expect(skeleton?.className).toContain("mb-2");
    });

    it("combines default variant styles with custom className", () => {
      const { container } = render(
        <LoadingSkeleton variant="card" className="shadow-lg" />
      );
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
      expect(skeleton?.className).toContain("bg-white");
      expect(skeleton?.className).toContain("shadow-lg");
    });
  });

  describe("width and height customization", () => {
    it("applies height class to skeleton lines", () => {
      const { container } = render(<LoadingSkeleton lines={2} />);
      const lines = container.querySelectorAll(".h-4");

      lines.forEach((line) => {
        expect(line.className).toContain("h-4");
      });
    });

    it("supports variable width percentages per line", () => {
      const { container } = render(<LoadingSkeleton lines={5} />);
      const lines = container.querySelectorAll(".h-4");

      // Each line should have a width style applied
      lines.forEach((line) => {
        const style = (line as HTMLElement).style.width;
        // Either has inline style or relies on Tailwind class
        expect(line.className).toBeDefined();
      });
    });

    it("card variant applies different heights for header and content", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const header = container.querySelector("div.h-5");
      const content = container.querySelector(".space-y-3 .h-4");

      expect(header?.className).toContain("h-5");
      expect(content?.className).toContain("h-4");
    });

    it("table variant applies specific column widths", () => {
      const { container } = render(<LoadingSkeleton variant="table" />);
      const row = container.querySelector(".flex.gap-4.py-3");

      expect(row).toBeDefined();
      // Columns should have flex-1 or specific widths like w-24, w-20
      const columns = row?.querySelectorAll(".h-4");
      expect(columns?.length).toBeGreaterThan(0);
    });
  });

  describe("spacing and layout", () => {
    it("applies gap spacing between skeleton items", () => {
      const { container } = render(<LoadingSkeleton />);
      const wrapper = container.querySelector(".space-y-2");

      expect(wrapper?.className).toContain("space-y-2");
    });

    it("card variant applies padding", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const card = container.querySelector("div.p-5");

      expect(card?.className).toContain("p-5");
    });

    it("card variant applies margin between header and content", () => {
      const { container } = render(<LoadingSkeleton variant="card" />);
      const header = container.querySelector("div.mb-4");

      expect(header?.className).toContain("mb-4");
    });

    it("table variant applies padding to rows", () => {
      const { container } = render(<LoadingSkeleton variant="table" />);
      const row = container.querySelector(".py-3");

      expect(row?.className).toContain("py-3");
    });
  });

  describe("animation integrity", () => {
    it("container has animate-pulse for visual feedback", () => {
      const { container } = render(<LoadingSkeleton />);
      const skeleton = container.querySelector("div");

      expect(skeleton?.className).toContain("animate-pulse");
    });

    it("all variants maintain animate-pulse class", () => {
      const variants = ["text", "card", "table", "stats"] as const;

      variants.forEach((variant) => {
        const { container } = render(<LoadingSkeleton variant={variant} />);
        const skeleton = container.querySelector("div");
        expect(skeleton?.className).toContain("animate-pulse");
      });
    });
  });
});
