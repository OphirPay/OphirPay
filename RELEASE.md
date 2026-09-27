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

### 4a. Publish the container image (automated, issue #749)

Pushing a `v*.*.*` tag triggers
[`.github/workflows/release.yml`](./.github/workflows/release.yml), which:

1. Builds the existing `Dockerfile` for `linux/amd64` **and** `linux/arm64`
   with Buildx.
2. Pushes to GHCR (`ghcr.io/ophirpay/ophirpay`) using the built-in
   `GITHUB_TOKEN` (no long-lived registry secret) with these tags:
   - `v0.X.0` — the immutable semantic-version tag that `k8s/deployment.yaml`
     and `helm/ophirpay/values.yaml` pin by default;
   - `sha-<full commit sha>` — traceable back to the exact commit;
   - `latest` — a **moving** convenience tag, published only for a
     non-prerelease tag (its use is discouraged; see below).
3. Attaches an **SBOM** (SPDX for the image, CycloneDX for the node
   dependencies) and a **build provenance attestation** to the image, and
   keyless-signs the digest with cosign (issue #750).
4. Uploads the SBOM files as a workflow artifact and attaches them to the
   GitHub release when one exists for the tag.

To exercise the pipeline without publishing anything (a build-only dry run):

```bash
gh workflow run release.yml --repo OphirPay/OphirPay \
  -f dry_run=true -f version=v0.X.0
```

> **Immutable tags by default (issue #749).** The k8s manifest and the Helm
> chart pin `v0.1.0`, not `latest`, and use `imagePullPolicy: IfNotPresent`.
> Override deliberately, e.g.
> `helm upgrade ophirpay helm/ophirpay --set image.tag=v0.X.0`.

### 5. GitHub Release

1. Go to [GitHub Releases](https://github.com/OphirPay/OphirPay/releases)
2. Click "Draft a new release"
3. Choose the tag `v0.X.0`
4. Copy the relevant section from `CHANGELOG.md` as the release notes
5. Attach WASM artifacts if applicable
6. Publish

> If the release already exists when `release.yml` runs, the SBOM files are
> attached to it automatically; otherwise re-run the workflow (or upload them
> by hand from the run's artifacts) after publishing the release.

### 6. Post-Release

- [ ] Verify the release appears on the [Releases page](https://github.com/OphirPay/OphirPay/releases)
- [ ] Verify the image digest and its attestations (see below)
- [ ] Announce in community channels
- [ ] Update demo deployment if applicable

## Verifying a release artifact

Every release image carries an SBOM and a build provenance attestation. A
consumer does not have to trust the tag — they can verify the artifact was
built by this repository's release workflow, from a specific commit.

```bash
# 1. Resolve the tag to a digest (never copy a mutable tag into prod).
docker buildx imagetools inspect ghcr.io/ophirpay/ophirpay:v0.X.0

# 2. Verify the GitHub build-provenance attestation for that digest.
#    Requires GitHub CLI >= 2.49 and a read:packages token.
gh attestation verify \
  oci://ghcr.io/ophirpay/ophirpay@sha256:<digest> \
  --repo OphirPay/OphirPay

# 3. Inspect the SBOM attached by BuildKit (registry-side attestation).
docker buildx imagetools inspect \
  ghcr.io/ophirpay/ophirpay:v0.X.0 --format '{{ json .SBOM }}'

# 4. Or verify the keyless cosign signature.
cosign verify \
  --certificate-identity-regexp '^https://github.com/OphirPay/OphirPay/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/ophirpay/ophirpay:v0.X.0
```

The standalone SBOM files (`ophirpay-image.spdx.json`,
`ophirpay-dependencies.cdx.json`) are reproducible from the release page or the
workflow run artifacts. `docs/DEPLOYMENT.md` documents the same steps from the
operator's point of view.

## Hotfix Process

For critical bugs in production:

1. Branch from the latest release tag: `git checkout -b hotfix/description v0.X.0`
2. Fix the bug, add tests
3. Open a PR against `main` with the `hotfix` label
4. After merge, follow the release checklist with a PATCH bump
