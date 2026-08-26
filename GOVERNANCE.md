# OphirPay Governance

This document defines the governance model for the OphirPay open-source project.

## Roles

| Role | Description | Permissions |
|---|---|---|
| **Maintainer** | Core project steward | Merge PRs, cut releases, manage CI, triage issues |
| **Contributor** | Anyone who submits a merged PR | Submit PRs, review code, participate in discussions |
| **Community Member** | Anyone using or interested in OphirPay | Open issues, ask questions, provide feedback |

## Decision Making

### Consensus Model

OphirPay uses a **lazy consensus** model:

1. A proposal is made via GitHub Issue or PR
2. The community has reasonable time to comment (typically 3-7 days)
3. If no objections are raised, the proposal is accepted
4. If objections are raised, maintainers facilitate discussion to reach consensus

### Tie-Breaking

If consensus cannot be reached, **maintainers** make the final decision. Decisions should be:
- Documented in the relevant issue or PR
- Based on project principles: safety, simplicity, and Stellar ecosystem alignment

## Maintainer Responsibilities

- Review and merge PRs that pass all CI checks
- Enforce the [Code of Conduct](CODE_OF_CONDUCT.md)
- Triage issues and assign labels
- Cut releases following [RELEASE.md](RELEASE.md)
- Keep documentation accurate and up to date
- Manage security disclosures per [SECURITY.md](SECURITY.md)

## Becoming a Maintainer

Contributors who demonstrate sustained, high-quality contributions may be invited to become maintainers. The process:

1. Existing maintainer nominates the contributor
2. All maintainers vote (simple majority)
3. If accepted, the new maintainer is added to the GitHub organization and CODEOWNERS

## Removing a Maintainer

A maintainer may be removed by unanimous vote of all other maintainers if they:
- Violate the Code of Conduct
- Are inactive for 6+ months without notice
- Act against the project's interests

## Project Principles

1. **Safety first**: Smart contract changes must never introduce vulnerabilities
2. **Backward compatibility**: Breaking changes require a MAJOR version bump
3. **Tests required**: New features must include tests (Rust + TypeScript)
4. **Documentation required**: New features must update relevant docs
5. **Open by default**: Discussions happen in public GitHub Issues

## Amendments

This governance document can be amended by a maintainer vote (simple majority). Proposed amendments must be open for community comment for at least 7 days before voting.
