# Release Process

This document describes how to cut a new release of OphirPay.

## Versioning

OphirPay follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking contract API changes, storage layout changes
- **MINOR** (0.x.0): New features, new contract functions, new pages
- **PATCH** (0.0.x): Bug fixes, documentation, dependency updates

## Release Checklist

### 1. Pre-Release Verification

```bash
# All CI checks must pass (15 jobs)
npm run ci

# Contract tests (46 Rust tests)
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test

# Frontend tests (68 tests)
npm test

# E2E tests (15 tests)
npx playwright test
```

### 2. Update Documentation

- [ ] Update `CHANGELOG.md` — move [Unreleased] section to new version
- [ ] Update version in `package.json`
- [ ] Update `CONTRACT_VERSION` in `contracts/ophirpay/src/lib.rs`
- [ ] Verify README badges and test counts are accurate
- [ ] Update Roadmap section if features moved from Planned → Done

### 3. Deploy Contracts (Testnet)

```bash
./scripts/deploy-all.sh <DEPLOYER_SECRET_KEY>

# Verify contract IDs in .env.contract
# Update NEXT_PUBLIC_CONTRACT_ID and NEXT_PUBLIC_EMITTER_CONTRACT_ID
```

### 4. Create Git Tag

```bash
git tag -a v0.X.0 -m "Release v0.X.0"
git push origin v0.X.0
```

### 5. GitHub Release

1. Go to [GitHub Releases](https://github.com/OphirPay/OphirPay/releases)
2. Click "Draft a new release"
3. Choose the tag `v0.X.0`
4. Copy the relevant section from `CHANGELOG.md` as the release notes
5. Attach WASM artifacts if applicable
6. Publish

### 6. Post-Release

- [ ] Verify the release appears on the [Releases page](https://github.com/OphirPay/OphirPay/releases)
- [ ] Announce in community channels
- [ ] Update demo deployment if applicable

## Hotfix Process

For critical bugs in production:

1. Branch from the latest release tag: `git checkout -b hotfix/description v0.X.0`
2. Fix the bug, add tests
3. Open a PR against `main` with the `hotfix` label
4. After merge, follow the release checklist with a PATCH bump
