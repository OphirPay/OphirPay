# Changelog Maintenance Guide

This guide explains how OphirPay maintains [`CHANGELOG.md`](../CHANGELOG.md). It is the
reference for every contributor who adds or updates a changelog entry, and for
maintainers who cut releases.

The changelog follows **[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)**
and the project uses **[Semantic Versioning 2.0.0](https://semver.org/)**.

---

## 1. Why we keep a changelog

`CHANGELOG.md` is the first thing users, integrators, and operators read when a
release lands. It must answer three questions without reading a single commit:

1. **What changed?** — the user-visible outcome, not the implementation detail.
2. **Is it breaking?** — did any API, contract interface, config key, or behavior change?
3. **When did it land?** — which release (or `[Unreleased]`) introduced it.

The file is written for humans. Commits are for machines; the changelog is for
people. If a change is not user-facing (a refactor with identical behavior, an
internal test-only change, CI plumbing), it does **not** need an entry.

## 2. File structure

```text
# Changelog

All notable changes to OphirPay will be documented in this file.

## [Unreleased]

### Added
### Changed
### Fixed
### Removed
### Security

## [0.2.0] — 2026-08-31

### Added
...

## [0.1.0] — 2026-08-05

### Added
...
```

Rules that keep the file diff-friendly and reviewable:

- **One `## [Unreleased]` section at the top.** Do not start a new
  `[Unreleased]` heading for every PR — new entries go under the existing one.
- **One date per release heading**, in `YYYY-MM-DD` (ISO 8601) format.
- **Entries are grouped by category** under `### ` subheadings. Omit a category
  heading when it has no entries for that release.
- **Each entry is a bullet point** that starts with a short, bolded summary and
  explains the *why* where it matters. Entries are ordered most-recent-first
  within a category.
- **No trailing punctuation required**, but entries must be complete sentences
  when read aloud.
- **Never edit a released section** except to fix a factual error in an entry
  you authored. Released sections are historical record — append a correction
  to `[Unreleased]` instead.

## 3. Change categories (with examples)

Keep a Changelog defines six categories. The five required by this project's
conventions are **Added, Changed, Fixed, Removed, Security**; **Deprecated** is
used when a feature is marked for removal but still works.

### Added — new functionality

> Use for new user-visible features, new API endpoints, new contract
> functions, new pages, new configuration options.

```markdown
### Added
- **Refunds page**: Request → Approve → Process lifecycle, reason code
  analytics bar chart, status badges, Freighter signing
- **On-chain notification hooks**: `register_hook` / `unregister_hook`,
  9 event type selector, active/inactive badges
- **Demo mode**: `NEXT_PUBLIC_DEMO_MODE=true` enables simulated TXs, demo
  wallet with 10K XLM, pre-generated data — no real funds needed
```

### Changed — changes to existing functionality

> Use for behavior changes, refactors with observable effects, dependency
> upgrades, and performance improvements. **Call out breaking changes
> explicitly** — they also belong in the PR description and (for contracts)
> in `docs/AUDIT.md`.

```markdown
### Changed
- **Next.js 16 upgrade**: bumped `next` + `eslint-config-next` to 16.3 —
  removed the removed `instrumentationHook` config option
- **React Query rollout complete**: all 16 remaining data-driven pages
  converted from raw `fetch` + `useState` to `useApiQuery` / `useApiMutation`
- **Wallet network**: 5 connectors now use `NEXT_PUBLIC_STELLAR_NETWORK` env
  var instead of hardcoded "PUBLIC"
```

### Fixed — bug fixes

> Use for any correction of incorrect behavior. Name the symptom and, where it
> helps the reader, the root cause.

```markdown
### Fixed
- **Governance list renders real proposals**: `GET /api/governance/proposals`
  now enumerates proposals on-chain and returns an array; the page previously
  received a bare count number and always showed the empty state
- **Timelock `?id=` validation**: non-numeric ids return a clean 400 instead
  of a 500 from `nativeToScVal`
- **Audit-log SSE leak**: EventSource now closes on page unmount, not just on
  toggle-off
```

### Removed — features that were taken out

> Use when a feature, endpoint, function, or option is deleted. If removal is
> breaking, say so and point to the replacement.

```markdown
### Removed
- **`instrumentationHook` config option**: removed with the Next.js 16 upgrade
  (enabled by default in 16)
- **Hardcoded testnet fallbacks**: contract IDs and RPC source are now
  env-driven with launch-time validation — no testnet fallback values remain
```

### Security — vulnerability fixes

> Use for security-relevant fixes: reentrancy, access-control bypasses,
> signature issues, CSRF, secret handling. These entries get extra scrutiny
> during review, and fixes should be coordinated through the process in
> [`SECURITY.md`](../SECURITY.md) when the issue is not yet public.

```markdown
### Security
- **Voting weight**: `vote_on_proposal` no longer accepts self-reported
  `weight` parameter. Each address gets exactly 1 vote per proposal with
  double-vote prevention via persistent storage tracking
- **Reentrancy guard**: added `REENTRANCY_LOCK` with acquire/release helpers,
  applied to `emergency_withdraw`, `emergency_pause_all`,
  `emergency_unpause_all`
- **Min proposal deposit**: `create_proposal` now requires `deposit_asset` +
  `deposit_amount` params, validated against `config.min_proposal_deposit`
```

> Use the canonical heading `### Security` for new entries. Early changelog
> entries (2026-08-11 and earlier) used `### Security Fixes`; new entries
> should not perpetuate that spelling.

### Deprecated — soon-to-be-removed features

> Use when a feature still works but is planned for removal. Name the timeline
> or replacement if known. (This category is currently unused in the changelog
> — it is listed here for completeness.)

```markdown
### Deprecated
- **`GET /api/legacy`**: deprecated in favor of `GET /api/v2/legacy`; will be
  removed in 1.0.0
```

## 4. Writing good entries

A high-quality entry is:

- **Concise** — one bullet, usually one to three lines.
- **Specific** — names the function, endpoint, page, or config key.
- **Outcome-oriented** — describes the behavior a user will observe, not the
  internal machinery ("the page now enumerates proposals on-chain" beats
  "refactored the governance route").
- **Self-contained** — a reader who has not seen the PR understands the entry.

Style rules used across the existing changelog:

- Start each bullet with a **bolded summary phrase** followed by a colon:
  `- **Feature name**: description`.
- Use backticks for code identifiers: `record_payment`, `NEXT_PUBLIC_*`,
  `src/app/api/**/route.ts`.
- Spell out numbers under 10 in prose; keep numeric literals for counts and
  versions (`.nvmrc` → Node 20, 94 error variants).
- If the entry refers to error codes, contract functions, or env vars, the
  names must match the code exactly — reviewers will check.

## 5. When an entry is required

Add or update a `[Unreleased]` entry in the same PR whenever the change is
**user-facing**, including:

- new functionality (features, endpoints, contract functions, pages)
- changed behavior (API semantics, defaults, config keys, env vars)
- bug fixes that users can observe
- removed features or APIs
- security fixes
- public documentation changes that materially affect users (setup steps,
  config reference, deployment guide)

Internal changes that do **not** need an entry:

- refactors with identical observable behavior
- test-only changes and CI plumbing
- dependency bumps with no behavior change (still mention in the PR body)

> 💡 If you are unsure, ask in the PR. Reviewers will flag a missing entry on
> any user-facing change — it is a merge-blocking review comment.

## 6. Release flow

Releases are cut by maintainers from `main`. The flow is:

### Step 1 — Freeze

1. Confirm `main` is green: all 11 required CI checks pass.
2. Review the `[Unreleased]` section. Every entry should be complete,
   accurate, and categorized. Merge any remaining doc-only PRs that touch the
   changelog before cutting.

### Step 2 — Version

Pick the next version with Semantic Versioning:

| Change type | Version bump (1.0.0+) | Version bump (pre-1.0) |
|---|---|---|
| Breaking change (contract interface, API, config) | **MAJOR** (`X.0.0`) | **MINOR** (`0.X.0`), called out explicitly |
| Backward-compatible feature / behavior expansion | **MINOR** (`0.X.0`) | **MINOR** (`0.X.0`) |
| Bug fix / documentation-only user-facing update | **PATCH** (`0.0.X`) | **PATCH** (`0.0.X`) |

Rules observed in this repo:

- **After 1.0.0**, a breaking change (renamed/removed public contract
  functions, changed signatures, new required args, changed API or config
  semantics) is always a MAJOR bump. The `1.0.0` release marks where the
  public API stabilizes.
- **Before 1.0.0** (the current `0.x` line), the semver convention for
  pre-1.0 software applies: breaking changes may ship in `MINOR` bumps
  (`0.1.0` → `0.2.0`) while the API is still stabilizing. This is not a
  contradiction — it is standard semver practice. Each breaking change must
  still be called out explicitly in the changelog entry and the release
  notes so integrators can adapt, and the `1.0.0` release should collect
  the remaining breaking changes before the strict MAJOR rule applies.
- The version lives in `package.json` (`"version"`), the changelog heading,
  and the git tag. Keep all three in sync in the release commit.

### Step 3 — Cut the release

1. Replace the `## [Unreleased]` heading with the new version and today's
   date: `## [0.2.0] — 2026-08-31`.
2. Create a fresh, empty `## [Unreleased]` section above it.
3. Bump `package.json` to the new version.
4. Add a version-diff link block at the bottom of the file (see
   [Keep a Changelog — how can I make it easier to compare versions?](https://keepachangelog.com/en/1.1.0/#how-can-i-make-it-easier-to-compare-versions))
   if the file does not already have one.
5. Open a PR titled `chore(release): vX.Y.Z` with the changelog diff. It must
   pass the same checks as any other PR.
6. After merge, tag the release commit: `git tag vX.Y.Z` and push the tag.
   (Only maintainers can do this step.)
7. Announce in the release notes / GitHub Release, summarizing the changelog.

### Step 4 — After the release

- Any change merged after the tag lands under the new `[Unreleased]` section.
- Hotfixes to a released version are cut from the release tag, then merged
  back to `main` so the fix also appears in `[Unreleased]`.

## 7. PR checklist for changelog entries

Copy this into the PR body (or use the repo's PR template) when your change is
user-facing:

- [ ] Added an entry under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md)
- [ ] Entry is under the correct category (`Added` / `Changed` / `Fixed` / `Removed` / `Security`)
- [ ] Entry is concise, specific, and outcome-oriented
- [ ] Entry names the actual functions / endpoints / env vars / config keys
- [ ] Breaking changes are explicitly marked as breaking
- [ ] Security fixes follow the disclosure process in [`SECURITY.md`](../SECURITY.md)
      when the issue is not yet public
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass locally

## 8. Links

- [`CHANGELOG.md`](../CHANGELOG.md) — the changelog itself
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) — the convention this guide implements
- [Semantic Versioning](https://semver.org/) — the versioning scheme
- [Contributing Guide](../CONTRIBUTING.md) — the general contribution workflow
