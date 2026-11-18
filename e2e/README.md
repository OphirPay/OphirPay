# Playwright tests: E2E and visual regression

This directory holds the end-to-end specs. The visual regression specs live in
[`tests/visual/`](../tests/visual/) but are driven by Playwright too, which is
why their local/Docker instructions live here as well.

| Suite | Specs | Config | Command | Needs a running app |
|---|---|---|---|---|
| E2E | `e2e/*.spec.ts` | `playwright.config.ts` | `npm run test:e2e` | **yes** |
| Visual regression | `tests/visual/*.spec.ts` | `playwright.visual.config.ts` | `npm run test:visual` | **yes** |
| Offline subset | `@offline` specs | `playwright.config.ts` | `npm run test:e2e:offline` | no |

Neither config has a `webServer` block, so Playwright never starts the app
itself. Start it first (`npm run dev`, or a production build) and point the
tests at it with `E2E_BASE_URL` (default `http://localhost:3000`).

For the full E2E setup — database, migrations, seed data, contract
configuration and which specs mock their network boundaries — read
[docs/E2E_TESTING.md](../docs/E2E_TESTING.md). This page covers the visual
suite and the browser/runtime setup both suites share.

## Visual regression tests

Screenshots of the critical pages are committed as baselines and compared on
every run. The config defines six projects:

| Project | Scope |
|---|---|
| `visual-light`, `visual-dark` | Every page in `visual-regression.spec.ts`, at 1440×900, one screenshot per colour scheme |
| `visual-mobile-light`, `visual-mobile-dark` | `visual-payment-modal.spec.ts` at 375×667 |
| `visual-mobile-wide-light`, `visual-mobile-wide-dark` | `visual-payment-modal.spec.ts` at 414×896 |

`visual-network-status-banner.spec.ts` covers the RPC status banner states and
runs under the two desktop projects.

- Baselines: `tests/visual/__screenshots__/<spec>/<project>/<name>.png`.
  The project name is part of the path, so light and dark captures can never
  overwrite each other — **regenerate both, commit both**.
- Threshold: `maxDiffPixelRatio: 0.001` (0.1% of pixels), with
  `animations: "disabled"`. Each spec also pins the persisted theme and asserts
  `html[data-theme]` matches the project before capturing.
- Reports: `playwright-visual-report/` (HTML report with expected/actual/diff
  images). It is generated output — do not commit it.

### Direct execution (recommended on Linux)

```bash
# 1. Install the browser and its OS dependencies (visual tests use Chromium only)
npx playwright install --with-deps chromium

# 2. Start the app in another terminal
npm run dev

# 3. Compare against the committed baselines
npm run test:visual

# Narrow the run while iterating
npm run test:visual -- --project=visual-dark
npm run test:visual -- tests/visual/visual-regression.spec.ts --project=visual-light
```

`npx playwright install chromium` installs the browser but not the shared
libraries it links against; `--with-deps` (or a one-off
`sudo npx playwright install-deps chromium`) installs those too. Without them
Chromium exits immediately with a `libnss3.so` / `libatk-1.0.so` style error.

### Docker execution (byte-identical across platforms)

Visual baselines are rendered by a specific Chromium build on a specific
distro. Font hinting and system fonts differ between macOS and Linux, so a
baseline generated on a laptop can legitimately fail in CI (or vice versa)
without any UI change. Running inside the official Playwright image removes
that variable.

The image tag must match `@playwright/test` in
[`package.json`](../package.json) — currently **1.62.1**:

```bash
# From the repository root. --network host lets the container reach the app
# served on the host's localhost:3000 (Linux; see the note below for macOS).
docker run --rm -it \
  --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/.npm \
  -e E2E_BASE_URL=http://localhost:3000 \
  -v "$PWD":/work \
  -w /work \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  bash -lc "npm ci && npx playwright test -c playwright.visual.config.ts"
```

To regenerate baselines the same way:

```bash
docker run --rm -it \
  --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/.npm \
  -e E2E_BASE_URL=http://localhost:3000 \
  -v "$PWD":/work \
  -w /work \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  bash -lc "npm ci && npx playwright test -c playwright.visual.config.ts --update-snapshots"
```

Notes on the command:

- `npm ci` runs **inside** the container on purpose. `node_modules` installed
  on the host can contain native binaries built for a different libc.
- `--user` + `HOME=/tmp` keep the files the run writes (report, updated
  screenshots, `.npm` cache) owned by you instead of `root`/`pwuser`.
- On macOS/Windows Docker Desktop, `--network host` does not reach the host's
  `localhost`. Run the app in the container network instead, or expose it and
  pass `-e E2E_BASE_URL=http://host.docker.internal:3000`.
- Drop `--user` only if you accept root-owned files in the working tree.

## Updating baselines

Only after a deliberate UI change:

```bash
# Regenerate EVERY project's baselines (desktop light/dark + all mobile)
npm run test:visual:update
```

Then:

1. Review the changed PNGs — `git status tests/visual/__screenshots__` shows
   exactly which pages/projects moved.
2. Open the expected/actual/diff images in `playwright-visual-report/` for any
   page whose diff you did not expect.
3. Commit the regenerated screenshots with the UI change, in the same PR.

Never run `--update-snapshots` to make a red run green. If you cannot explain
why a pixel moved, it is a regression until proven otherwise.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `browserType.launch: Executable doesn't exist` | Chromium not installed for this Playwright version | `npx playwright install chromium` |
| Chromium exits instantly, `error while loading shared libraries` | Missing OS libraries | `npx playwright install --with-deps chromium`, or use Docker |
| Every page differs, including static headings | Wrong rendering environment: different OS/fonts, wrong browser, or a Playwright/Chromium version mismatch | Compare inside the pinned Docker image; `npx playwright --version` should be 1.62.1 |
| Every screenshot is the same blank/error page | The app was not reachable at `E2E_BASE_URL` | `curl --fail http://localhost:3000/api/health` before the run |
| One page differs only in charts, dates or on-chain values | Dynamic content did not settle | Re-run; check the page manually; use `VISUAL_PAYMENT_ID` for the payment-detail baseline if the deployment has no payment `1` |
| Diff is tiny and only on text edges | Font anti-aliasing / font fallback differs from the environment that produced the baseline | Regenerate once inside the matching Docker image, then keep using that environment |
| Mobile modal specs are skipped/ignored | They are matched only by the `visual-mobile*` projects | Run `npm run test:visual` (all projects) or `--project=visual-mobile-dark` |
| Baselines updated, but CI still fails | Only one colour scheme or viewport was regenerated | Re-run `npm run test:visual:update` so all six projects regenerate, and commit every changed PNG |

## CI

The trimmed PR CI does not run the visual suite; the nightly
[`e2e-nightly`](../.github/workflows/e2e-nightly.yml) workflow runs the
`playwright.config.ts` E2E suite. Visual verification is a contributor
responsibility before review — run it locally, ideally in Docker, and say so in
the PR.
