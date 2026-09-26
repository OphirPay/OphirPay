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

### 5. GitHub Release & Provenance Attestations

1. Go to [GitHub Releases](https://github.com/OphirPay/OphirPay/releases)
2. Click "Draft a new release"
3. Choose the tag `v0.X.0`
4. Copy the relevant section from `CHANGELOG.md` as the release notes
5. Attach WASM artifacts (`ophirpay_contract.wasm`, `ophirpay_emitter.wasm`)
6. Publish
7. The **Release Artifacts, SBOM & Provenance** workflow (`.github/workflows/release-artifacts.yml`) automatically:
   - Generates machine-readable Software Bill of Materials (SBOM) in both **CycloneDX v1.5** (`ophirpay-node-sbom.cdx.json`, `ophirpay-container-sbom.cdx.json`) and **SPDX 2.3** (`ophirpay-node-sbom.spdx.json`)
   - Produces cryptographically verifiable **build provenance attestations** backed by Sigstore and GitHub Artifact Attestations
   - Attaches all SBOMs and provenance records to the GitHub Release

### 6. Post-Release & Verification

- [ ] Verify the release appears on the [Releases page](https://github.com/OphirPay/OphirPay/releases)
- [ ] Confirm SBOMs and provenance attestations are attached
- [ ] Announce in community channels
- [ ] Update demo deployment if applicable

## Verifying Release Artifacts & Provenance

Downstream consumers, node operators, and auditors can independently verify that release artifacts (container images and SBOMs) were built directly from this repository without tampering.

### 1. Verify Build Provenance with GitHub CLI

Verify that the published container image or artifact originates from OphirPay CI:

```bash
# Verify container image provenance
gh attestation verify oci://ghcr.io/ophirpay/ophirpay:v0.X.0 --owner OphirPay

# Verify SBOM file provenance
gh attestation verify ophirpay-node-sbom.cdx.json --owner OphirPay
```

Expected output confirms the signer, workflow filename, repository, and commit SHA:
```text
Loaded digest sha256:... for oci://ghcr.io/ophirpay/ophirpay:v0.X.0
Loaded 1 attestation from GitHub
✓ Verification succeeded!
  Signer: GitHub Actions (release-artifacts.yml)
  Repository: OphirPay/OphirPay
```

### 2. Inspect the Software Bill of Materials (SBOM)

Download the attached CycloneDX or SPDX SBOM from the release page or workflow artifacts:

```bash
# Generate SBOM locally on demand:
npm run generate:sbom -- --format both --out-dir build/sbom

# Inspect CycloneDX SBOM components:
jq '.components[] | {name, version, purl}' build/sbom/ophirpay-node-sbom.cdx.json
```

### 3. Verification with Cosign (Optional)

If verifying with `cosign`:

```bash
cosign verify ghcr.io/ophirpay/ophirpay:v0.X.0 \
  --certificate-identity-regexp '^https://github.com/OphirPay/OphirPay/' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

## Hotfix Process

For critical bugs in production:

1. Branch from the latest release tag: `git checkout -b hotfix/description v0.X.0`
2. Fix the bug, add tests
3. Open a PR against `main` with the `hotfix` label
4. After merge, follow the release checklist with a PATCH bump
