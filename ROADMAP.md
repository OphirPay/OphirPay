# OphirPay Roadmap

## Q3 2026 (Current)

### In Progress / Done
- [x] Voting weight security fix (1 address = 1 vote)
- [x] Reentrancy guard on cross-contract calls
- [x] Minimum proposal deposit enforcement
- [x] Error code expansion (52 → 300)
- [x] React Query data fetching layer
- [x] Zod validation on API routes
- [x] CSRF protection for mutations
- [x] Docker distroless base image
- [x] 20-job CI/CD pipeline
- [x] Pre-submission hardening pass (one commit per fix, all pushed to `main`)
  - [x] Governance proposal enumeration now works and creates proposals with real deposits
  - [x] On-chain return values (proposal/request/refund/hook ids) captured from tx meta
  - [x] Refund & hook lifecycles synced end-to-end (DB ledger rows linked by `onChainId`)
  - [x] No empty-caller contract invocations anywhere in the UI/API
  - [x] Stale test expectations aligned with the 300-code catalog — full suite green
  - [x] OpenAPI spec expanded to cover all 40 API routes
  - [x] Docs numbers (tests, versions, gas) aligned with reality

### Submission Milestone (Q3 2026)

**Goal:** submit OphirPay to Stellar Drips Wave + Grantfox with a demo-ready,
fully-green repository.
- [x] 0 failing tests across 800 vitest + 64 Rust contract tests
- [x] End-to-end refund lifecycle (Request → Approve → Process) demonstrable in the UI
- [x] Multisig approve/execute address real on-chain request ids
- [x] Security, Performance & Gas, and Audit-Readiness documented in the README
- [ ] Record fresh demo video + screenshots against the seeded demo environment
- [ ] External security audit (Runtime Verification or Certora)
- [ ] Formal verification of key contract invariants — 10/10 Kani *model* proofs exist but do not verify the deployed contract (see contracts/ophirpay/spec/ and docs/AUDIT.md)

### Up Next
- [ ] Contract modularization (split into Payment/Escrow/Governance modules)
- [ ] Redis-backed distributed rate limiting
- [ ] Bug bounty program on Immunefi

## Q4 2026

- [ ] Mainnet deployment with $1M+ TVL target
- [ ] Token-weighted governance (governance token + snapshot system)
- [ ] Mobile wallet SDK (React Native)
- [ ] Fiat on-ramp integration (Kado, MoonPay)
- [ ] Cross-chain bridge support (Sep-38 anchors)
- [ ] Real-time WebSocket API (replace SSE polling)
- [ ] Automated market maker for fee distribution

## Q1 2027

- [ ] Layer-2 / state channel payments for high-frequency use cases
- [ ] Multi-party computation (MPC) wallet integration
- [ ] Regulatory compliance framework (Travel Rule, KYC/AML)
- [ ] Insurance fund for smart contract risk
- [ ] DAO transition (remove admin key, full on-chain governance)

## Long-term Vision

- **10M+ payments processed** on Stellar mainnet
- **Institutional-grade custody** via Fireblocks / Copper integration
- **Cross-chain payments** via Stellar anchors + IBC
- **ZK-proof audit trails** for privacy-preserving payment verification
- **Open-source grant program** for ecosystem contributors
