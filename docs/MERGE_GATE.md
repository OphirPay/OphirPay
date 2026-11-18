# Pull request merge gate

While `integration/staging` exists, pull requests must target that branch. The
required checks below run on pull requests and are the merge gate. Run
`npm run ci` locally for the application checks; the repository-specific
commands are listed so failures can be reproduced individually.

| Required check                                            | Workflow                         | Local command                                                        |
| --------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| Typecheck                                                 | `ci.yml`                         | `npm run typecheck`                                                  |
| ESLint (zero warnings)                                    | `ci.yml`                         | `npm run lint -- --max-warnings 0`                                   |
| Unit tests                                                | `ci.yml`                         | `npm test`                                                           |
| Next.js build                                             | `ci.yml`                         | `npm run build`                                                      |
| Deploy configuration guards                               | `ci.yml`                         | `bash scripts/validate-deploy-config.sh`                             |
| Contract WASM and Rust tests                              | `ci.yml`                         | `cd contracts/ophirpay && cargo test`; repeat in `contracts/emitter` |
| Secrets scan                                              | `ci.yml`                         | `gitleaks detect --config .gitleaks.toml --redact`                   |
| Helm lint/render                                          | `ci.yml`                         | `helm lint helm/ophirpay`                                            |
| `prisma-gate` (Prisma schema and migration replay)        | `prisma-ci.yml`                  | `npm run db:validate:migrations`                                     |
| `contract-regression-gate` (WASM size and fee guardrails) | `contract-regression.yml`        | `node scripts/check-contract-regressions.mjs`                        |
| `docker-smoke-gate` (image build and compose smoke test)  | `docker-smoke.yml`               | `docker build -t ophirpay:smoke . && docker compose up -d app`       |
| Integration-branch policy                                 | `enforce-integration-branch.yml` | Open the PR against `integration/staging`                            |

### Gate jobs for path-scoped workflows

`prisma-ci.yml`, `contract-regression.yml` and `docker-smoke.yml` do **not** use
workflow-level `paths:` filters. When a workflow is skipped by a path filter its
check never reports, so marking it required in branch protection leaves every
unrelated PR stuck on “Expected — waiting for status”. Instead, each of the
three workflows:

1. runs a `changes` job (`dorny/paths-filter`, pinned to a commit SHA) that
   detects whether its area was touched;
2. runs the heavy job only when that filter matches;
3. runs a final gate job with `if: always()` that succeeds when the heavy job
   passed **or** was legitimately skipped, and fails when it failed or the
   change detection failed.

Require **only the gate jobs** — `prisma-gate`, `contract-regression-gate` and
`docker-smoke-gate` — in branch protection. Do not require `changes` or the
heavy jobs (`prisma`, `contract-regression`, `docker-smoke`): they are skipped
on most PRs and would reproduce the stuck-pending problem.

Because the gates always report, a docs-only PR shows all three as passed with
the heavy jobs skipped, while a PR touching `prisma/**`, `contracts/**` or the
Docker inputs runs the full job and fails the gate when the job fails. The
integration-branch policy (`enforce-base`) remains required for every PR while
the batch-integration branch exists.

## Keeping `integration/staging` in sync with `main`

`main` still receives commits directly (release chores, hotfixes, and the
promotion merge itself), so the integration branch would drift behind it and
batch-mode PRs would be built and tested against a stale base.
[`sync-integration-branch.yml`](../.github/workflows/sync-integration-branch.yml)
closes that gap:

- It runs on every push to `main` (and on demand through `workflow_dispatch`).
- It checks out `integration/staging` and runs `git merge --ff origin/main`, so
  a clean fast-forward is used when possible and a merge commit otherwise, then
  pushes the result.
- The push is authenticated with the `INTEGRATION_SYNC_TOKEN` secret: a GitHub
  App installation token or a fine-grained PAT with **Contents: read and
  write** on this repository. `GITHUB_TOKEN` is deliberately not used — a push
  made with it does not trigger `on: push` workflows, so the sync commit would
  land without CI. The workflow fails with setup instructions when the secret
  is missing instead of pushing an untested commit.
- A conflicting merge is aborted. The workflow opens (or updates, keyed by a
  marker in the body) an open issue titled
  `integration-sync: main conflicts with integration/staging` listing the
  conflicting files and the commands to resolve them. The next push to `main`
  refreshes that issue; close it once the branch is current again.
- When `integration/staging` does not exist (batch mode over), the workflow is
  a no-op.

A PAT/App token is required because a push made with `GITHUB_TOKEN` does not
trigger `on: push` workflows: the sync commit would be invisible to any
branch-triggered CI. With a token, workflows triggered by a push to the
integration branch run on the sync commit, and
[`prompt-promotion-pr.yml`](../.github/workflows/prompt-promotion-pr.yml) can
report the real "0 commits behind" state.

## Scheduled or advisory workflows

The following workflows are operational or advisory and are not merge-gate
checks for an ordinary pull request:

- `dependency-scan.yml` — nightly dependency vulnerability scan.
- `e2e-nightly.yml` — scheduled/dispatch end-to-end coverage.
- `scheduled-payments-cron.yml` — scheduled payment sweep.
- `db-backup.yml` — scheduled database backup.
- `scorecard.yml` — scheduled OpenSSF scorecard analysis.
- `stale.yml` — scheduled issue and PR housekeeping.

Review the repository’s branch-protection settings when changing the required
list; this document describes the intended gate, not a replacement for GitHub
settings. Every check named in the table above uses a job `name` (or job id when
no name is set) that must match the entry selected in GitHub exactly.

## One-command local gate

```bash
npm ci
npm run ci
```

The command runs typecheck, lint, unit tests, production build, and deploy
configuration validation in the same order as the main application workflow.
