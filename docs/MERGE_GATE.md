# Pull request merge gate

While `integration/staging` exists, pull requests must target that branch. The
required checks below run on pull requests and are the merge gate. Run
`npm run ci` locally for the application checks; the repository-specific
commands are listed so failures can be reproduced individually.

| Required check | Workflow | Local command |
| --- | --- | --- |
| Typecheck | `ci.yml` | `npm run typecheck` |
| ESLint (zero warnings) | `ci.yml` | `npm run lint -- --max-warnings 0` |
| Unit tests | `ci.yml` | `npm test` |
| Next.js build | `ci.yml` | `npm run build` |
| Deploy configuration guards | `ci.yml` | `bash scripts/validate-deploy-config.sh` |
| Contract WASM and Rust tests | `ci.yml` | `cd contracts/ophirpay && cargo test`; repeat in `contracts/emitter` |
| Secrets scan | `ci.yml` | `gitleaks detect --config .gitleaks.toml --redact` |
| Helm lint/render | `ci.yml` | `helm lint helm/ophirpay` |
| Prisma schema and migration replay | `prisma-ci.yml` | `npm run db:validate:migrations` |
| Contract regression guard | `contract-regression.yml` | `node scripts/check-contract-regressions.mjs` |
| Integration-branch policy | `enforce-integration-branch.yml` | Open the PR against `integration/staging` |

The path-scoped Prisma and contract checks are required when their files are
changed. The integration-branch policy is required for every PR while the
batch-integration branch exists.

## Scheduled or advisory workflows

The following workflows are operational or advisory and are not merge-gate
checks for an ordinary pull request:

- `dependency-scan.yml` — nightly dependency vulnerability scan.
- `e2e-nightly.yml` — scheduled/dispatch end-to-end coverage.
- `scheduled-payments-cron.yml` — scheduled payment sweep.
- `db-backup.yml` — scheduled database backup.
- `scorecard.yml` — scheduled OpenSSF scorecard analysis.
- `stale.yml` — scheduled issue and PR housekeeping.

`docker-smoke.yml` may run on pull requests, but it is an auxiliary deployment
smoke test unless branch protection explicitly marks its check required. Review
the repository’s branch-protection settings when changing the required list;
this document describes the intended gate, not a replacement for GitHub
settings.

## One-command local gate

```bash
npm ci
npm run ci
```

The command runs typecheck, lint, unit tests, production build, and deploy
configuration validation in the same order as the main application workflow.
