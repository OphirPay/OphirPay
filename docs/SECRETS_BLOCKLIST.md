# Secrets Blocklist Policy

OphirPay CI runs [Gitleaks](https://github.com/gitleaks/gitleaks) on every push and pull request to prevent secrets from being committed.

## Blocked Patterns

| Category | Pattern | Severity |
|----------|---------|----------|
| Stellar Secret Keys | `S[A-Z2-7]{55}` | Critical |
| Private Keys (PEM) | `-----BEGIN ... PRIVATE KEY-----` | Critical |
| Generic API Keys | `api_key=...`, `secret=...`, `token=...` | High |

## What Happens When a Secret is Detected

1. CI **fails immediately** and the PR cannot be merged
2. The Gitleaks report shows the file, line, and pattern matched
3. You must **remove or revoke** the secret and force-push a clean commit

## How to Fix

```bash
# Option 1: Remove the secret, amend, and force-push
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch <file-with-secret>" \
  --prune-empty --tag-name-filter cat -- --all
git push --force

# Option 2: Rotate the exposed secret immediately
# Contact security@ophirpay.com if a valid secret was committed
```

## Exceptions

To whitelist a false positive, add a `#gitleaks:allow` comment on the line above the match:

```
#gitleaks:allow
const EXAMPLE_KEY = "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" // test key
```

## Reporting

If you discover a committed secret in the repository history, report it to **security@ophirpay.com**. Do not open a public issue.
