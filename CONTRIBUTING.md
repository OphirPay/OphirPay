# Contributing to OphirPay

Thank you for your interest in contributing! OphirPay is an open-source payment orchestration layer for Stellar.

## Getting Started

> **Fastest path:** Open this repository in a **Devcontainer** (GitHub Codespaces or VS Code). It automatically provisions Node 24, the pinned Rust toolchain + WASM targets, Postgres, and Redis. Just copy `.env.example` to `.env.local` and run `npm run dev`.

1. Ensure you have **Node.js 24** installed (see `.nvmrc`) — `npm install`
   runs a preflight (`scripts/check-node.mjs`) and aborts with an actionable
   message on any other major, so there is no ambiguity about the supported
   runtime
2. Fork the repository
3. Clone your fork: `git clone https://github.com/YOUR_USERNAME/OphirPay.git`
4. Install dependencies: `npm install`
5. Set up the database: `npx prisma db push && npx prisma generate`
6. Start the dev server: `npm run dev`

> 🛠️ **Setup trouble?** See the
> [Troubleshooting Guide](docs/TROUBLESHOOTING.md) — it covers Freighter
> detection, the Rust `wasm32` target, Prisma migrations, WASM builds,
> Node version mismatches, and port conflicts.

> 💡 **New to Stellar or Soroban?** Check out the
> [Stellar & Soroban glossary](GLOSSARY.md) — it defines the terms used
> throughout the codebase (XLM, testnet, friendbot, Horizon, Soroban, SAC,
> WASM, Freighter, memo, trustline, path payments, sponsored reserves, and
> more).

### Supported toolchain

| Tool    | Supported | Declared in                                                                                                  |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js | **24.x**  | `.nvmrc` (`24`), `package.json` → `engines.node` (`24.x`), and `node-version-file: .nvmrc` in every workflow |
| npm     | **10.x**  | `package.json` → `packageManager` (`npm@10.8.2`)                                                             |

`.nvmrc` is the single source of truth. `npm install` / `npm ci` run the
`preinstall` hook first, so an unsupported Node major stops immediately with:

```
[ERROR] Unsupported Node.js version.
  required : Node 24.x (.nvmrc → "24", package.json engines.node → "24.x", packageManager → "npm@10.8.2")
  running  : Node 24.14.0

Switch to the supported version and re-run the install:
  nvm install && nvm use        # reads .nvmrc
```

A running npm major that differs from `packageManager` is reported as a
warning rather than an error (a newer npm on Node 24 still installs the same
lockfile), but please install with the pinned manager to avoid lockfile churn.

**Bumping the version** — change `.nvmrc` and `engines.node` together, then run
`npm test -- node-preflight`. `src/__tests__/node-preflight.test.ts` fails if
`.nvmrc`, `engines.node`, `packageManager` or any workflow's
`node-version-file` disagree, so a half-finished bump cannot merge.

## Development Workflow

- **Branch naming**: `feat/feature-name`, `fix/bug-description`, `docs/what-changed`, `ci/what-changed`, `test/what-changed`
- **Commits**: Follow [Conventional Commits](https://www.conventionalcommits.org)
- **Before submitting**: Run `npm run ci` (typecheck → lint → test → build)

### Local secret scanning (pre-commit hook)

`npm install` (via the `prepare` script) points git at the committed
`.githooks/` directory, so a pre-commit hook scans **staged** changes with
[gitleaks](https://github.com/gitleaks/gitleaks) before they can reach a branch:

```bash
npm run prepare          # (re)enable the hook — also runs on `npm install`
npm run secrets:precommit  # run the scan by hand against the staged changes
npm run secrets:scan       # scan the whole repo with .gitleaks.toml
```

What it does:

- Uses the same `.gitleaks.toml` as CI, which extends gitleaks' ~160 default
  rules **and** adds a strict Stellar secret-seed rule (`S` + 55 base32 chars).
- Blocks the commit (exit 1) when a seed, API key or private key is staged.
- Skips with a warning when gitleaks is not installed — run one of
  ```bash
  brew install gitleaks                                   # macOS
  # or grab a release binary: https://github.com/gitleaks/gitleaks/releases
  ```
  to enable it. CI still scans every PR regardless, so a bypassed hook never
  reaches `main` unnoticed.

If gitleaks flags a **documented, non-sensitive** demo value, add it (with a
short reason) to the `[allowlist]` in `.gitleaks.toml` rather than committing
with `--no-verify`. Never commit a real key or seed: remove it, rotate the
credential, and re-stage.

> The hook is committed at `.githooks/pre-commit` and wired via
> `core.hooksPath` (set by `scripts/install-git-hooks.mjs`) — no husky
> dependency, and the hook itself is reviewable in the repo.

### Type safety and lint suppressions

Use `unknown` with a type guard or a narrower domain type instead of `any`.
Type-safety ESLint suppressions should be avoided; when a targeted suppression
is necessary, keep it to one line and explain why on that line. The zero-warning
ESLint check runs in CI.

## Frontend Styling Guidelines & Tailwind Conventions

All UI components in OphirPay must maintain visual consistency, adhere to our design tokens in [`tailwind.config.ts`](tailwind.config.ts), support light/dark modes seamlessly, and comply with WCAG 2.1 AA accessibility standards.

### 1. Design Tokens & Color Palette

OphirPay defines semantic color tokens extended in Tailwind:

| Token Group        | Palette / Values                                                  | Usage & Context                                                                     |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Ophir Primary**  | `ophir-50` through `ophir-950` (`ophir-600: #1b6cf5`)             | Brand identity, primary buttons, active navigation, focus rings (`ring-ophir-500`). |
| **Stellar Accent** | `stellar` (`DEFAULT: #14b7e6`, `dark: #0e8db3`, `light: #5ed5f7`) | Gradient accents, Stellar network badges, asset highlights.                         |
| **Neutrals**       | Tailwind `gray-50` through `gray-950`                             | Backgrounds, surface borders, typography, separators.                               |
| **Feedback**       | `green-600` (success), `red-600` (danger), `amber-500` (warning)  | Status badges, error messages, alerts, and transactional confirmations.             |

**Border Radius:**

- Buttons & pills: `rounded-full`
- Cards & modals: `rounded-xl`
- Inputs & dropdowns: `rounded-lg`
- Tooltips & badges: `rounded-md`

---

### 2. Typography & Hierarchy

Use standard font utilities and maintain typographic scale:

- **Headings**:
  - Page Titles (H1): `text-2xl font-bold text-gray-900 dark:text-white`
  - Section Headings (H2): `text-lg font-semibold text-gray-900 dark:text-white`
  - Subsections (H3): `text-base font-medium text-gray-900 dark:text-gray-100`
- **Body Text**:
  - Primary text: `text-sm text-gray-700 dark:text-gray-300`
  - Muted / captions: `text-xs text-gray-500 dark:text-gray-400`
- **Monospace Numbers & Addresses**:
  - Stellar addresses, amounts, and hashes: `font-mono text-xs tracking-tight`

---

### 3. Dark Mode Conventions

OphirPay supports system and manual theme toggling via class-based dark mode (`dark` prefix).

- **Always pair light and dark utility classes:** Never specify a light background or text color without its dark mode counterpart.
  - Card background: `bg-white dark:bg-gray-900`
  - Primary text: `text-gray-900 dark:text-white`
  - Secondary text: `text-gray-600 dark:text-gray-300`
  - Borders: `border-gray-200 dark:border-gray-800`
  - Subtly divided headers: `border-gray-100 dark:border-gray-800/60`
- **Focus Rings:** Include dark mode ring offsets:
  ```html
  class="focus-visible:ring-2 focus-visible:ring-ophir-500 focus-visible:ring-offset-2
  dark:focus-visible:ring-offset-gray-900"
  ```
- **Avoid hardcoded hex colors** in inline styles. Rely on Tailwind classes configured in [`tailwind.config.ts`](tailwind.config.ts).

---

### 4. Standard UI Components & Patterns

Whenever building new interfaces, use or extend the shared primitives in [`src/components/ui/`](src/components/ui/):

#### A. Button Variants ([`src/components/ui/Button.tsx`](src/components/ui/Button.tsx))

Buttons use `rounded-full font-medium transition-all duration-300` and interactive state handling:

| Variant     | Tailwind Classes                                                                                                                                            | Usage                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `primary`   | `bg-gradient-to-r from-ophir-600 to-stellar-dark text-white shadow-lg shadow-ophir-500/25 hover:from-ophir-700 hover:to-stellar active:shadow-ophir-500/40` | Main call-to-actions, submission actions.              |
| `secondary` | `bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700`        | Alternative actions, cancels, secondary options.       |
| `outline`   | `bg-transparent text-ophir-700 dark:text-ophir-400 border border-ophir-300 dark:border-ophir-700 hover:bg-ophir-50 dark:hover:bg-ophir-950/30`              | Tertiary actions, filters, view switches.              |
| `ghost`     | `bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white`                        | Header icons, dropdown items, subtle table actions.    |
| `danger`    | `bg-red-600 text-white shadow-lg shadow-red-500/25 hover:bg-red-700 active:shadow-red-500/40`                                                               | Destructive operations (delete, revoke, cancel batch). |
| `success`   | `bg-green-600 text-white shadow-lg shadow-green-500/25 hover:bg-green-700 active:shadow-green-500/40`                                                       | Completion confirmations, payouts.                     |

**Standard Button Sizes:**

- `sm`: `px-3 py-1.5 text-xs gap-1.5`
- `md`: `px-5 py-2.5 text-sm gap-2` (Default)
- `lg`: `px-6 py-3 text-base gap-2`

#### B. Card Paddings ([`src/components/ui/Card.tsx`](src/components/ui/Card.tsx))

Cards wrap content in `bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800`.

- `none`: `p-0` (for custom layouts or edge-to-edge tables)
- `sm`: `p-3` (compact summary cards or nested panels)
- `md`: `p-5` (default dashboard widgets, detail views)
- `lg`: `p-7` (major forms or hero presentation panels)

#### C. Form Inputs ([`src/components/ui/Form.tsx`](src/components/ui/Form.tsx))

All inputs (`Input`, `Textarea`, `Select`) must provide explicit labels and handle error states:

- Base input styling: `rounded-lg border bg-white dark:bg-gray-900 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-ophir-500/40 focus:border-ophir-500`
- Error border & ring: `border-red-500 focus:border-red-500 focus:ring-red-500/30`
- Icons: Left icon `pl-9`, Right icon `pr-9` with absolute positioning

---

### 5. Accessibility (a11y) & Contrast Guidelines

OphirPay enforces WCAG 2.1 AA accessibility standards:

1. **Color Contrast:**
   - Normal text (< 18pt / 24px) must maintain at least **4.5:1** contrast ratio against its background.
   - Large text (≥ 18pt or bold ≥ 14pt) and UI controls/borders must maintain at least **3:1** contrast ratio.
   - Never rely on color alone to convey status; always pair colored indicators with text or icons.
2. **Keyboard Accessibility:**
   - All interactive elements must be focusable using `Tab`.
   - Never use `outline-none` without providing an explicit replacement focus ring (`focus-visible:ring-2`).
3. **ARIA Attributes:**
   - Input errors must be marked with `aria-invalid="true"` and linked to error descriptions using `aria-describedby="{id}-error"`.
   - Error messages must include `role="alert"`.
   - Icon-only buttons must provide an explicit `aria-label` describing the action (e.g. `aria-label="Copy public key"`).

### Dependency Updates

[Dependabot](.github/dependabot.yml) checks the `npm` (root `package-lock.json`),
`cargo` (`contracts/ophirpay` and `contracts/emitter`) and `github-actions`
ecosystems once a week.

- Minor and patch bumps in an ecosystem are grouped into a **single** PR; major
  bumps arrive individually so they can be reviewed on their own.
- Update PRs are labelled `dependencies` and use a `chore(deps)` commit prefix.
- Review one like any other PR: wait for CI (the `contract-wasm` job matters for
  Cargo bumps) and run it locally for security-sensitive packages. If a bump has
  breaking changes or fails CI, coordinate with the team before merging instead
  of force-landing it.

#### Batch mode: update PRs target `integration/staging`

While `integration/staging` exists, every `updates` entry in
[`.github/dependabot.yml`](.github/dependabot.yml) sets
`target-branch: "integration/staging"`. Dependabot opens version **and**
security update PRs against that branch, so they pass
`enforce-integration-branch.yml`. A Dependabot PR based on `main` is rejected by
that guard and can never merge while batch mode is active.

**Switching back when batch mode ends.** Once the promotion PR is merged into
`main` and `integration/staging` is deleted:

1. Remove the `target-branch: "integration/staging"` line from **all four**
   `updates` entries in `.github/dependabot.yml` (npm, both Cargo entries, and
   `github-actions`). Omitting the field restores the repository default branch
   (`main`); `target-branch: "main"` is equivalent.
2. Update this section (and the batch-mode notes in
   [`docs/MERGE_GATE.md`](docs/MERGE_GATE.md)) so the docs no longer describe
   the integration branch as live.
3. Retarget outstanding update PRs. Dependabot applies `target-branch` only
   when it **opens** a PR, so PRs created before the config change keep their
   old base: comment `@dependabot recreate` on each (or close and reopen it) to
   get a fresh PR against `main`.

> The reverse also holds: when batch mode starts, update PRs opened before
> `target-branch` was added stay based on `main` until they are recreated. Let
> one finish its run, then comment `@dependabot recreate` to retarget it.

### Issue triage & stale policy

The [stale workflow](.github/workflows/stale.yml) runs every Monday and closes
issues that have been inactive for **60 days + a 14-day grace period**. Bounty
work is exempt, so the wave backlog does not get closed out from under a
contributor:

| Signal on the issue                                                      | Result                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Label `bounty` or `Stellar Wave`                                         | **Never** marked stale — a wave round may outlive the inactivity window              |
| Any assignee (claimed work)                                              | **Never** marked stale — the claim is the activity signal                            |
| Label `pinned`, `security`, `blocked`, `good first issue`, `help wanted` | **Never** marked stale                                                               |
| Any milestone                                                            | Exempt (`exempt-all-issue-milestones`)                                               |
| Anything else, unassigned                                                | Marked `stale` after 60 days, closed 14 days later — commenting or pushing clears it |

Pull requests follow a shorter clock (30 days stale, 7 days to close); `pinned`,
`blocked` and `security` PRs plus drafts are exempt.

When adding a new long-running programme (a wave, a funded milestone, a
migration epic), add its label to `exempt-issue-labels` in
`.github/workflows/stale.yml` **and** to the table above so maintainers can see
the policy in one place.

### Adding or changing an API endpoint

Before adding or modifying an API endpoint, read the [API Endpoint Guide](docs/API_GUIDE.md). It documents the mandatory conventions: file structure, Zod validation, the error-handling pattern, auth middleware usage, the response envelope, rate-limit integration, a copy-pasteable worked example, and a pre-merge checklist.

## CI/CD Pipeline

See [`docs/MERGE_GATE.md`](docs/MERGE_GATE.md) for the authoritative table of
required pull-request checks, local commands, and scheduled workflows that do
not block merges.

Every PR triggers the following independent CI/CD checks across quality,
testing, security, and DevOps. The jobs in `.github/workflows/ci.yml` are the
merge gate, and `npm run ci` runs the same frontend chain locally
(typecheck → lint → test → build → deploy-config guards) so the two cannot
drift apart again.

| #   | Job (workflow)                                                                    | Runs on PR                      | Blocks merge |
| --- | --------------------------------------------------------------------------------- | ------------------------------- | ------------ |
| 1   | `lint` — ESLint `--max-warnings 0` (`ci.yml`)                                     | ✅                              | ✅ Required  |
| 2   | `typecheck` — tsc (`ci.yml`)                                                      | ✅                              | ✅ Required  |
| 3   | `unit-tests` — Vitest (`ci.yml`)                                                  | ✅                              | ✅ Required  |
| 4   | `build` — Next.js production build (`ci.yml`)                                     | ✅                              | ✅ Required  |
| 5   | `contract-wasm` — Soroban WASM build + tests (`ci.yml`)                           | ✅                              | ✅ Required  |
| 6   | `deploy-config` — deploy-script config guards (`ci.yml`)                          | ✅                              | ✅ Required  |
| 7   | `secrets-scan` — Gitleaks (`ci.yml`)                                              | ✅                              | ✅ Required  |
| 8   | `helm-lint` — Helm lint + render (`ci.yml`)                                       | ✅                              | ✅ Required  |
| 9   | `prisma-gate` — schema + migration replay gate (`prisma-ci.yml`)                  | ✅ (full job on prisma paths)   | ✅ Required  |
| 10  | `contract-regression-gate` — WASM size guardrail gate (`contract-regression.yml`) | ✅ (full job on contract paths) | ✅ Required  |
| 11  | `docker-smoke-gate` — Docker build + smoke gate (`docker-smoke.yml`)              | ✅ (full job on Docker inputs)  | ✅ Required  |
| 12  | `enforce-base` — integration-branch guard (`enforce-integration-branch.yml`)      | ✅                              | ✅ Required  |

> **Batch mode**: while the `integration/staging` branch exists, every PR must
> target it instead of `main` (enforced by `enforce-integration-branch.yml`),
> and `ci.yml` runs on PRs against that branch as well as `main`.

### Branch Protection Rules (recommended)

Configure these in **Settings → Branches → Branch protection rules** for `main`
(and `integration/staging` while batch mode is active):

- **Require a pull request before merging**: ✅
- **Require approvals**: 1 minimum
- **Dismiss stale pull request approvals when new commits are pushed**: ✅
- **Require status checks to pass before merging**: ✅
  - Required checks: `lint`, `typecheck`, `unit-tests`, `build`, `contract-wasm`, `deploy-config`, `secrets-scan`, `helm-lint`, `prisma-gate`, `contract-regression-gate`, `docker-smoke-gate`, `enforce-base`
  - The path-scoped workflows are required through their **gate** jobs only; the heavy jobs are skipped on unrelated PRs and never report a status. See [`docs/MERGE_GATE.md`](docs/MERGE_GATE.md#gate-jobs-for-path-scoped-workflows).
- **Require conversation resolution before merging**: ✅
- **Require signed commits**: Recommended
- **Require linear history**: Recommended
- **Do not allow bypassing the above settings**: ✅

### Merge Requirements Summary

> A PR must pass every required check above (including the `prisma-gate`,
> `contract-regression-gate` and `docker-smoke-gate` gates and the `enforce-base`
> policy check) and have at least **1 approving review** before it can be merged.

## Testing

### Soroban contract tests

Both contract crates use the same layout:

- Put unit tests that need private implementation details in
  `contracts/<crate>/src/test.rs`.
- Put tests that exercise only the public contract API, including integration
  and property tests, in `contracts/<crate>/tests/`.
- Run a crate's complete Rust suite with `cd contracts/<crate> && cargo test`.

This keeps implementation-level tests in the unit-test harness and gives
public-contract tests the same integration-test harness in both crates.

```bash
npm test              # Run all tests (800 frontend)
npm run test:watch    # Watch mode
npm run coverage      # Coverage report
npm run typecheck     # TypeScript check
npm run lint          # ESLint
npm run test:openapi  # OpenAPI spec ↔ implementation conformance (drift)
npm run test:e2e      # E2E tests (requires a running server at E2E_BASE_URL)
npm run test:visual   # Visual regression tests
npm run test:visual:update # Update visual baselines
```

### Coverage ratchet

Coverage is enforced by **per-directory budgets**, not one global number
(`vitest.config.ts`). A single 80% global threshold was simultaneously too
strict for thin, presentational surface area and too lenient for the
money-handling API and security modules: a well-covered component could
subsidise a thinly-covered auth or webhook module and keep the aggregate green.

The measured surface is `src/lib/**`, `src/components/**`, `src/hooks/**` and
`src/app/**`. `src/app/api/**` is included exactly once, as part of
`src/app/**` — do not add a second, overlapping include entry.

| Band                   | Glob(s)                                                                                                                                                       | Baseline (st / br / fn / ln) | Budget            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------- |
| 1 · API route handlers | `src/app/api/**`                                                                                                                                              | 71.3 / 68.9 / 70.4 / 74.4    | 71 / 68 / 70 / 74 |
| 1 · Security modules   | `src/lib/{auth-rate-limit,auth-session,challenge,csrf,csrf-route-registry,crypto,lookup-rate-limit,sanitize,session,validation-schemas,webhook-url-guard}.ts` | 90.4 / 90.1 / 94.1 / 92.5    | 90 / 89 / 93 / 92 |
| 2 · Shared lib logic   | `src/lib/**`                                                                                                                                                  | 87.8 / 84.7 / 91.2 / 89.2    | 87 / 84 / 90 / 89 |
| 3 · UI components      | `src/components/**`                                                                                                                                           | 70.4 / 75.0 / 69.1 / 71.5    | 70 / 74 / 69 / 71 |
| 3 · Hooks              | `src/hooks/**`                                                                                                                                                | 95.3 / 82.5 / 95.7 / 97.1    | 95 / 82 / 95 / 97 |
| 3 · App pages          | `src/app/**`                                                                                                                                                  | 55.2 / 52.5 / 43.6 / 56.9    | 55 / 52 / 43 / 56 |

A file must clear **every band whose glob it matches**, so the strictest band
wins. That is what makes a security module's budget bite even though it also
sits inside the broader `src/lib/**` band.

**The ratchet only turns one way: budgets may rise, never fall.** When a change
raises a band's measured coverage, bump that band's numbers in
`vitest.config.ts` in the same PR. Lowering a budget to make a red build green is
a review-blocking change — fix the coverage or document the exception
explicitly in the PR description instead. Baselines in the table above are
refreshed whenever a band's budget moves.

```bash
# Run the gate locally exactly as CI does
npm run coverage
```

### Bundle-size budget

The client JavaScript has a committed per-route budget in
[`bundle-budget.json`](bundle-budget.json), enforced in CI by
`scripts/check-bundle-budget.mjs` after the production build. The script reads
the App Router client-reference manifests (`.next/server/app/**`), unions each
route's first-load chunks, gzip-sizes them and fails with a per-route breakdown
when a route exceeds its budget. The table is also appended to the GitHub job
summary so reviewers see the delta on every PR.

```bash
npm run build         # produces .next
npm run bundle:check  # enforce the committed budgets

# Interactive treemap (opt-in; webpack-only, so it does not affect normal builds)
npm run analyze       # writes .next/analyze/*.html
```

Budgets are raised **deliberately** in a PR, with a reason. Do not bump a budget
just to make a red build green — trim the route instead.

### Dark-mode colour guard

`src/__tests__/dark-mode-color-guard.test.ts` fails CI if the colour-critical
components (status badges, toasts, the payment timeline, the analytics charts)
introduce a raw colour literal such as `text-[#ff0000]` or
`style={{ color: "#3b82f6" }}`. Use theme tokens (CSS variables) or a Tailwind
pair (`text-red-500 dark:text-red-400`) so the colour adapts to dark mode.

## Changelog

Every user-facing change must be recorded in [`CHANGELOG.md`](CHANGELOG.md).
The file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with
[Semantic Versioning](https://semver.org/).

- Read the [Changelog Maintenance Guide](docs/CHANGELOG_GUIDE.md) before adding
  or updating an entry — it documents the category conventions (Added / Changed /
  Fixed / Removed / Security) with examples and the release flow.
- Add entries under the existing `## [Unreleased]` section in the same PR as the
  change. Do not create a new `[Unreleased]` heading per PR.
- Internal changes (refactors with no observable behavior change, test-only
  changes, CI plumbing) do not need an entry.
- Reviewers will ask for an entry on any user-facing change; treat a missing
  entry as a review-blocking item.

See the [release flow](docs/CHANGELOG_GUIDE.md#6-release-flow) in the guide for
how versions are chosen and releases are cut.

## Smart Contracts

Contracts are in `contracts/`. Build with:

```bash
cd contracts/ophirpay && cargo test   # 58 contract tests
cd contracts/emitter && cargo test    # 6 emitter tests
```

Contract WASM size is enforced in CI (hard limit: 128 KB per contract, the
Soroban protocol limit) by the `contract-regression` job in
`.github/workflows/contract-regression.yml`.

## Pull Request Process

1. Create a branch from the branch the issue targets (`main`, or
   `integration/staging` while batch mode is active): `feat/my-feature` or
   `fix/my-bug`
2. Make your changes, following existing code conventions
3. Run `npm run ci` locally to verify everything passes
4. Push and open a PR against that branch — CI runs automatically
5. Ensure all required checks pass (✅ green)
6. Request review from a maintainer (CODEOWNERS auto-assigns reviewers)
7. Once approved and all checks pass, squash-merge to the target branch

## Issue Labels & Their Meanings

OphirPay uses a two-tier label scheme: **plain labels** (semantic) and
**emoji labels** (stack-area). Bounty-eligible work is tagged with a
**`bounty`** label plus a **`Stellar Wave`** program label and a
**`difficulty:`** estimate.

### Semantic labels

| Label              | Meaning                                     | What to do with it                                       |
| ------------------ | ------------------------------------------- | -------------------------------------------------------- |
| `bug`              | Something isn't working                     | Reproduce, add a failing test, fix, reference `Fixes #…` |
| `enhancement`      | New feature or improvement request          | Discuss scope in the issue, then implement               |
| `feature`          | Larger feature-tracked work                 | See the linked epic/Roadmap item                         |
| `documentation`    | Docs-only change (guides, README, comments) | Edit docs; keep commands copy-pasteable and verified     |
| `good first issue` | Small, well-scoped task for newcomers       | Grab it — it's the intended on-ramp                      |
| `help wanted`      | Extra attention needed                      | Comment to coordinate before starting                    |
| `question`         | Needs clarification, not code               | Answer with detail; close once resolved                  |
| `duplicate`        | Already tracked elsewhere                   | Link the original issue                                  |
| `invalid`          | Not a valid issue/PR for this repo          | Explain why when closing                                 |
| `wontfix`          | Accepted, will not be worked on             | Leave a note on the decision                             |

### Stack-area labels

| Label                              | Area                          | Example use                               |
| ---------------------------------- | ----------------------------- | ----------------------------------------- |
| `frontend` / `🎨 frontend`         | UI components, pages, styling | Payment form, dashboard                   |
| `backend` / `🔧 backend`           | API routes, server logic      | `/api/payments`, rate limiting            |
| `contracts` / `📦 contracts`       | Soroban Rust contracts        | `contracts/ophirpay`, `contracts/emitter` |
| `security` / `🔒 security`         | Auth, RBAC, secrets, audit    | `AUTH_SECRET`, governance, multisig       |
| `tests` / `🧪 tests`               | Vitest/Playwright coverage    | New unit or e2e tests                     |
| `ci`                               | CI/CD pipeline changes        | `.github/workflows/ci.yml`                |
| `performance`                      | Gas, latency, bundle size     | `docs/GAS.md` related work                |
| `devops` / `⚙️ devops`             | Docker, Helm, K8s, monitoring | `helm/`, `k8s/`, `monitoring/`            |
| `database` / `🗄️ database`         | Prisma schema & migrations    | `prisma/schema.prisma`                    |
| `dependencies` / `📦 dependencies` | npm/cargo dependency bumps    | Renovate/Dependabot PRs                   |
| `hooks` / `🪝 hooks`               | React hooks                   | `src/lib/`, custom hooks                  |
| `types` / `📐 types`               | TypeScript types & ABI        | `src/types/contract-abi.ts`               |
| `lib` / `📚 lib`                   | Shared libraries              | `src/lib/` utilities                      |
| `docs` / `📝 docs`                 | Documentation                 | Guides in `docs/`                         |

> 💡 **PR auto-labeling**: the `pr-labeler` CI job applies stack-area labels to
> PRs automatically from the changed paths — you don't need to label your PR
> by hand.

## Bounty Process (Stellar Wave)

OphirPay participates in the **Stellar Wave** bounty program. Bounty-eligible
issues carry the **`bounty`** + **`Stellar Wave`** labels and a difficulty
estimate (e.g. `difficulty: medium`). Each bounty issue's acceptance criteria
are the contract for payout — the PR must satisfy them exactly.

### Claiming a bounty

1. **Find a bounty issue** — filter for the `bounty` label (with `Stellar Wave`)
   and read its acceptance criteria + implementation hints.
2. **Comment to claim it**: reply on the issue saying you'd like to take it on
   (e.g. "I'd like to work on this one").
3. **Wait for assignment** — a maintainer will assign you. Do not open a PR
   for a bounty issue before you are assigned.
4. **Create your branch** from `main` using the issue's suggested branch name
   (e.g. `feat(wasm)/compute-WASM-hash-early-and-display-before-simulat`).
5. **Implement** following the issue's key-files hints and this guide's
   conventions (Conventional Commits, `npm run ci` green, tests added).
6. **Open the PR** referencing the issue with **`Closes #<number>`** in the
   description so the issue auto-closes on merge.
7. **Make sure CI is green** — all required checks must pass.
8. **Request review** from a maintainer and respond to feedback.
9. **Merge** — once approved and merged, the bounty issue closes and payout is
   processed per the program's terms.

### Bounty etiquette

- Claim **one issue at a time**; finish it before claiming the next.
- If you can't finish, **unassign yourself** (or comment) early so someone
  else can pick it up.
- **Don't** claim an issue and submit a PR that only partially satisfies the
  acceptance criteria — partial work delays the bounty and the review.
- A PR that references `Closes #…` for a bounty issue is the record of the
  work; keep the description detailed so reviewers can verify every
  acceptance criterion.

## Definition of Done (DoD) for PRs

A PR is **done** — ready for review and merge — when **all** of the following
hold. This mirrors the [pull request template](.github/pull_request_template.md)
and the required CI checks listed above.

### Functional & code requirements

- [ ] Addresses the issue's acceptance criteria **completely** (docs issues:
      every requested section exists and is accurate)
- [ ] Follows existing code conventions and the repo's style (Prettier + ESLint)
- [ ] For UI/frontend changes: follows [Frontend Styling Guidelines & Tailwind Conventions](#frontend-styling-guidelines--tailwind-conventions) (WCAG AA contrast, dark mode, ARIA)
- [ ] No new lint warnings (`npm run lint` clean)
- [ ] No new type errors (`npx tsc --noEmit` clean)
- [ ] Tests added/updated for the change, and the full suite passes
      (`npm test` — 1,000+ tests; contract changes also need `cargo test`)
- [ ] No new security findings (secret-scan, npm audit advisory level)

### Contract changes (additional)

- [ ] `cargo build --target wasm32v1-none --release` succeeds for the changed
      contract
- [ ] Contract WASM stays under the 128 KB Soroban protocol limit (CI
      enforces it)
- [ ] Rust tests added/updated in the contract's `src/lib.rs` and passing
- [ ] If the contract ABI changed: TypeScript types updated in
      `src/types/contract-abi.ts`

### Documentation changes (additional)

- [ ] Commands are copy-pasteable and were verified (or clearly marked as
      expectations)
- [ ] New docs are linked from the README or the appropriate index page
- [ ] No typos (`typos` spell-check CI job passes)
- [ ] Cross-links use relative paths so they work on GitHub and in the docs

### Checklist before opening the PR

- [ ] Branch is based on current `main` and named `feat/…`, `fix/…`,
      `docs/…`, `ci/…`, or `test/…`
- [ ] `npm run ci` passes locally (typecheck → lint → test → build)
- [ ] PR description explains **what** changed and **why**, references the
      issue with `Closes #…`, and includes a test plan
- [ ] All required CI checks are green on the PR
- [ ] At least 1 maintainer approval obtained before merge

> If any box can't be ticked, say so explicitly in the PR description with the
> reason — a documented exception beats a silent one.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
