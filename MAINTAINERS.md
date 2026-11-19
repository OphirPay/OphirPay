# OphirPay Maintainers

This file lists the current project maintainers and their areas of responsibility.

## Core Maintainers

| Name              | GitHub                                   | Role            | Focus Area                              |
| ----------------- | ---------------------------------------- | --------------- | --------------------------------------- |
| **OphirPay Team** | [@OphirPay](https://github.com/OphirPay) | Lead Maintainer | Overall project direction, architecture |

## Area Owners

Per [CODEOWNERS](.github/CODEOWNERS), PRs are auto-assigned to these teams:

| Area            | Team                       | Scope                                            |
| --------------- | -------------------------- | ------------------------------------------------ |
| Smart Contracts | `@OphirPay/core-contracts` | `contracts/` — Rust, Soroban, WASM               |
| Frontend        | `@OphirPay/frontend`       | `src/app/`, `src/components/` — Next.js, React   |
| Backend         | `@OphirPay/backend`        | `src/app/api/`, `prisma/` — API routes, database |
| DevOps          | `@OphirPay/devops`         | CI/CD, Docker, Kubernetes, Helm, scripts         |
| Documentation   | `@OphirPay/docs`           | `*.md`, `docs/`                                  |
| Security        | `@OphirPay/backend`        | `SECURITY.md`, auth, crypto, rate limiting       |

## Contact

- **General**: hello@ophirpay.dev
- **Security**: GitHub private advisory — see [SECURITY.md](SECURITY.md) (report by email is unavailable while no monitored mailbox is provisioned, issue #1280)
- **Conduct**: conduct@ophirpay.dev

## Emeritus

Maintainers who have stepped back from active duties but remain recognized for their contributions:

_(None yet — OphirPay is a young project!)_

---

_To add yourself as a maintainer, see [GOVERNANCE.md](GOVERNANCE.md#becoming-a-maintainer)._
