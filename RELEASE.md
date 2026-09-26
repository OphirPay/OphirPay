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

### 5. GitHub Release & Container Image Publishing

1. Go to [GitHub Releases](https://github.com/OphirPay/OphirPay/releases)
2. Click "Draft a new release"
3. Choose the tag `v0.X.0`
4. Copy the relevant section from `CHANGELOG.md` as the release notes
5. Attach WASM artifacts (`ophirpay_contract.wasm`, `ophirpay_emitter.wasm`)
6. Publish
7. The **Release Docker Image to GHCR** workflow (`.github/workflows/release-docker-ghcr.yml`) triggers automatically to:
   - Build multi-architecture container images (`linux/amd64`, `linux/arm64`)
   - Tag with semantic version (`v0.X.0`), major/minor (`v0.X`), commit SHA (`sha-<commit>`), and moving `latest` tag
   - Push to GitHub Container Registry (`ghcr.io/ophirpay/ophirpay`) with built-in `GITHUB_TOKEN`
   - Generate embedded SBOM and Sigstore build provenance attestations

### 6. Manual Dry-Run Workflow Dispatch

To verify the Docker build without pushing to GHCR:

1. Go to **Actions** → **Release Docker Image to GHCR**
2. Click **Run workflow**
3. Select branch/tag, enter the desired tag (e.g. `v0.X.0`), and uncheck **Push image to GHCR**
4. Inspect the workflow logs to verify build completion, SBOM, and provenance generation

### 7. Deployment Manifests & Tag Overrides

OphirPay Kubernetes and Helm manifests reference immutable version tags by default rather than mutable `latest`:

- **Kubernetes** (`k8s/deployment.yaml`):
  Defaults to `ghcr.io/ophirpay/ophirpay:v1.0.0` with `imagePullPolicy: IfNotPresent`.
  Override for deployment updates:
  ```bash
  kubectl set image deployment/ophirpay ophirpay=ghcr.io/ophirpay/ophirpay:v0.X.0 -n ophirpay
  # Or via commit SHA:
  kubectl set image deployment/ophirpay ophirpay=ghcr.io/ophirpay/ophirpay:sha-abc1234 -n ophirpay
  ```

- **Helm** (`helm/ophirpay/values.yaml`):
  Defaults to `image.tag: "v1.0.0"` and `image.pullPolicy: IfNotPresent`.
  Override via CLI flag or values file:
  ```bash
  helm upgrade --install ophirpay ./helm/ophirpay \
    --namespace ophirpay \
    --set image.tag=v0.X.0
  ```

### 8. Post-Release

- [ ] Verify the release appears on the [Releases page](https://github.com/OphirPay/OphirPay/releases)
- [ ] Verify image packages on [GitHub Packages (GHCR)](https://github.com/orgs/OphirPay/packages)
- [ ] Announce in community channels
- [ ] Update demo deployment if applicable

## Hotfix Process

For critical bugs in production:

1. Branch from the latest release tag: `git checkout -b hotfix/description v0.X.0`
2. Fix the bug, add tests
3. Open a PR against `main` with the `hotfix` label
4. After merge, follow the release checklist with a PATCH bump
