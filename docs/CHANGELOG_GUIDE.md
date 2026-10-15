# Conventional Changelog Guide

OphirPay maintains a structured [`CHANGELOG.md`](../CHANGELOG.md) adhering to [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases and release notes are generated automatically from [Conventional Commits](https://www.conventionalcommits.org) using `scripts/generate-changelog.mjs`.

---

## 🚀 Quick Start

Generate release notes for unreleased commits since the last tagged release:

```bash
# Preview unreleased changes to stdout (dry run)
npm run changelog

# Validate commit history and formatting without modifications
npm run changelog:check

# Generate and write new section to CHANGELOG.md
node scripts/generate-changelog.mjs --write

# Generate release notes for a specific tagged version
node scripts/generate-changelog.mjs --version 1.1.0 --write
```

---

## 📋 Commit Classification

Commits are parsed according to their Conventional Commit type and categorized as follows:

| Category | Commit Prefix | Description |
| --- | --- | --- |
| **Breaking Changes** | `feat!:`, `fix!:`, `BREAKING CHANGE:` | Incompatible API or contract changes |
| **Features** | `feat:` | New capabilities, endpoints, or UI features |
| **Bug Fixes** | `fix:` | Bug fixes, edge case handling, regression repairs |
| **Performance** | `perf:` | Query optimizations, bundle reductions, latency improvements |
| **Security** | `security:`, `fix(security):`, `chore(security):` | Vulnerability fixes, auth hardening, CSP updates |
| **Documentation** | `docs:` | Guides, API documentation, troubleshooting notes |
| **Changed** | `refactor:`, `chore:`, `build:`, `ci:`, `test:` | Maintenance, dependency updates, internal refactoring |

---

## 🛠️ CLI Options

The generator script supports the following command-line flags:

```bash
node scripts/generate-changelog.mjs [options]
```

- `--from <ref>`: Starting Git reference or tag (defaults to the latest semver tag, e.g., `v1.0.0-rc1`).
- `--to <ref>`: Ending Git reference (defaults to `HEAD`).
- `--version <ver>`: Version label in the changelog section (defaults to `Unreleased`).
- `--write`: Inserts the generated release section directly below the `CHANGELOG.md` header.
- `--dry-run`: Prints the generated Markdown to stdout without writing (default mode).
- `--check`: Verifies that commit history can be parsed and formatted cleanly (exit 0 on success).
- `--help`: Displays help and usage instructions.

---

## 6. Release Flow

When cutting a new release:

1. **Verify commits**: Ensure all commits merged into `main` adhere to Conventional Commits.
2. **Run check**:
   ```bash
   npm run changelog:check
   ```
3. **Generate changelog**:
   ```bash
   node scripts/generate-changelog.mjs --version 1.1.0 --write
   ```
4. **Review and refine**: Inspect the generated section in `CHANGELOG.md`, making any editorial adjustments or grouping summaries as needed.
5. **Commit and tag**:
   ```bash
   git add CHANGELOG.md
   git commit -m "docs: update CHANGELOG for v1.1.0"
   git tag -a v1.1.0 -m "Release v1.1.0"
   ```
