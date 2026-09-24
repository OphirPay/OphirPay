# OphirPay

... (unchanged content)

## Testing

The repository ships with a comprehensive test suite powered by Playwright.

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run the full end‑to‑end test suite. |
| `npm run test:e2e:ui` | Open the Playwright UI runner. |
| `npm run test:a11y` | Run accessibility‑focused tests. |
| `npm run test:visual` | **Run visual regression tests** (compare screenshots against committed baselines). |
| `npm run test:visual:update` | **Update visual baselines** – use when intentional UI changes are made. |

> **Note**: Visual tests are defined in `playwright.visual.config.ts`. They will compare the current UI rendering with the snapshots stored under `tests/visual-baselines`. Use `npm run test:visual:update` only after verifying that the UI changes are expected.

... (remaining unchanged content)
