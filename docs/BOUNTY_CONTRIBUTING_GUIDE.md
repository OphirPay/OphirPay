# OphirPay Contributor & Bounty Program Guide

## Overview

Welcome to the OphirPay open-source contributor community! This document outlines our repository label taxonomy, bounty claim lifecycle, PR standards, and review expectations.

---

## 1. Issue Labels Taxonomy

| Label | Meaning | Action Required |
| :--- | :--- | :--- |
| `bounty` | Issue is funded and eligible for monetary/crypto reward upon merge | Open for community contribution |
| `good first issue` | Well-scoped introductory task for new contributors | Ideal starting point |
| `docs` | Documentation, guides, or API cookbook additions | Requires markdown lint compliance |
| `security` | Vulnerability fix or input sanitization | Requires comprehensive regression tests |
| `contract` | Soroban smart contract or Rust integration changes | Requires verification harness testing |

---

## 2. Bounty Lifecycle: From Claim to Payout

```
┌─────────────────┐
│ 1. Find Issue   │ ──> Search `is:open label:bounty`
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Submit PR    │ ──> Reference issue: `Closes #<ID>`
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Add EVM Addr │ ──> Comment payout wallet in PR/Issue
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Merge & Pay  │ ──> Maintainer approves & funds reward
└─────────────────┘
```

---

## 3. Definition of Done (DoD) for PRs

1. **Commit Hygiene:** Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`).
2. **Quality Checks:** Code must pass linting (`npm run lint`), formatting (`prettier`), and unit tests (`npm test`).
3. **No Breaking Changes:** Maintain schema backward compatibility.
