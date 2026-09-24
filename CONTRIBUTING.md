# Contributing to OphirPay

...

## GitHub Actions Concurrency Convention

All GitHub Actions workflows in this repository follow a strict concurrency policy to avoid
duplicate builds and unnecessary runner usage.

| Workflow Type | Concurrency Group | Cancel In Progress |
|---------------|-------------------|--------------------|
| **Pull‑request / push** | `${{ github.workflow }}-${{ github.ref }}` | **true** |
| **Scheduled** | `${{ github.workflow }}-singleton` | **false** |

### How to add concurrency to a new workflow

1. Add a `concurrency` block at the top of the workflow file (before `name:`).  
2. For PR or push workflows use the first row above.  
3. For scheduled workflows use the second row.  
4. Include a short comment explaining the concurrency policy (see examples in existing workflows).

Example for a PR workflow:

