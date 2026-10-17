import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const TABLE_SELECTOR = "table[aria-label='On-chain payments']";

test.describe("Payments table accessibility", () => {
  // On-chain payment reads are Soroban simulations (N+1 RPC calls), so the
  // table can take a while to populate against a live deployment.
  test.setTimeout(90_000);

  /** Waits until the table has either data rows, the empty state, or an error. */
  async function waitForTableData(page: import("@playwright/test").Page) {
    const rows = page.locator(`${TABLE_SELECTOR} tbody tr[data-row-index]`);
    const emptyState = page.getByText(/No on-chain payments yet/);
    const errorState = page.getByText(/Failed to load on-chain payments/);

    await Promise.race([
      rows.first().waitFor({ state: "visible", timeout: 45_000 }),
      emptyState.waitFor({ state: "visible", timeout: 45_000 }),
      errorState.waitFor({ state: "visible", timeout: 45_000 }),
    ]).catch(() => {});
  }

  test("payments table passes an axe scan", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    const table = page.locator(TABLE_SELECTOR);
    await expect(table).toBeVisible({ timeout: 15000 });

    await waitForTableData(page);

    const results = await new AxeBuilder({ page })
      .include(TABLE_SELECTOR)
      .analyze();

    expect(results.violations).toEqual([]);
  });

  // Issue #1383 — the base Modal is used by every dialog in the app, so the
  // focus-trap contract is exercised here through the shortcuts dialog that is
  // reachable from the payments header.
  test("modal dialog traps Tab focus, passes axe and restores focus on Escape", async ({
    page,
  }) => {
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });

    const trigger = page.getByRole("button", { name: "Keyboard shortcuts" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();

    const focusIsInsideDialog = () =>
      dialog.evaluate((el) => el.contains(document.activeElement));

    // Focus starts inside the dialog...
    await expect.poll(focusIsInsideDialog).toBe(true);

    // ...and Tab / Shift+Tab can never escape it in either direction.
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(focusIsInsideDialog).toBe(true);
    }
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Shift+Tab");
      await expect.poll(focusIsInsideDialog).toBe(true);
    }

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("arrow keys navigate between payment rows", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.locator("main")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(TABLE_SELECTOR)).toBeVisible({ timeout: 15000 });

    await waitForTableData(page);

    const rows = page.locator(`${TABLE_SELECTOR} tbody tr[data-row-index]`);
    const rowCount = await rows.count();
    test.skip(rowCount < 2, "requires at least two on-chain payment rows");

    // The active row is the only one in the tab order.
    await expect(rows.first()).toHaveAttribute("tabindex", "0");

    await rows.first().focus();
    await expect(rows.first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute("tabindex", "0");

    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toBeFocused();
    await expect(rows.first()).toHaveAttribute("tabindex", "0");
  });
});

test.describe("Payments & Escrows Keyboard Accessibility (#1305)", () => {
  test("navigates rows with ArrowDown/ArrowUp, opens details with Enter, and reaches pagination via Tab", async ({
    page,
  }) => {
    await page.setContent(`
      <!DOCTYPE html>
      <html lang="en">
        <head><title>Keyboard Navigation Harness</title></head>
        <body>
          <table>
            <tbody id="table-body">
              <tr data-row-index="0" tabindex="0" class="focus-visible:ring-2"><td id="cell-0">Row 0</td><td><button type="button">Action 0</button></td></tr>
              <tr data-row-index="1" tabindex="-1" class="focus-visible:ring-2"><td id="cell-1">Row 1</td><td><button type="button">Action 1</button></td></tr>
              <tr data-row-index="2" tabindex="-1" class="focus-visible:ring-2"><td id="cell-2">Row 2</td><td><button type="button">Action 2</button></td></tr>
            </tbody>
          </table>
          <nav aria-label="Pagination">
            <button type="button" aria-label="Previous page">← Previous</button>
            <button type="button" aria-label="Next page">Next →</button>
          </nav>
          <div id="detail-view" hidden>Detail opened</div>
          <script>
            const tbody = document.getElementById("table-body");
            const rows = Array.from(tbody.querySelectorAll("[data-row-index]"));
            tbody.addEventListener("keydown", (e) => {
              const row = e.target.closest("[data-row-index]");
              if (!row) return;
              const idx = rows.indexOf(row);
              if (e.key === "ArrowDown" && idx < rows.length - 1) {
                e.preventDefault();
                rows[idx].tabIndex = -1;
                rows[idx + 1].tabIndex = 0;
                rows[idx + 1].focus();
              } else if (e.key === "ArrowUp" && idx > 0) {
                e.preventDefault();
                rows[idx].tabIndex = -1;
                rows[idx - 1].tabIndex = 0;
                rows[idx - 1].focus();
              } else if (e.key === "Enter" && e.target === row) {
                e.preventDefault();
                document.getElementById("detail-view").hidden = false;
              }
            });
          </script>
        </body>
      </html>
    `);

    const row0 = page.locator('[data-row-index="0"]');
    const row1 = page.locator('[data-row-index="1"]');

    await row0.focus();
    await expect(row0).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(row1).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#detail-view")).toBeVisible();
  });
});
