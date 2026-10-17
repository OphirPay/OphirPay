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
```

---

## 📋 Commit Classification

Commits conforming to Conventional Commits are automatically categorized:

| Conventional Commit Prefix | Changelog Section | Description |
| -------------------------- | ----------------- | ----------- |
| `feat:` / `feat(scope):`   | **Features**      | New features or user-facing enhancements |
| `fix:` / `fix(scope):`     | **Bug Fixes**     | Fixes addressing bugs or incorrect behavior |
| `perf:` / `perf(scope):`   | **Performance**   | Performance and latency improvements |
| `security:` / `fix(security):` | **Security**  | Vulnerability mitigations and audit fixes |
| `docs:` / `docs(scope):`   | **Documentation** | Documentation guides and diagrams |
| `BREAKING CHANGE:` or `!:` | **Breaking Changes** | Incompatible API, contract, or behavior changes |
| `refactor:` / `chore:` / `ci:` / `test:` | **Changed** | Internal plumbing, maintenance, or test updates |

---

## 🛠️ CLI Options

The generator script supports the following command-line flags:

```bash
node scripts/generate-changelog.mjs [options]
```

- `--from <ref>`: Starting tag or commit SHA (defaults to latest semver git tag).
- `--to <ref>`: Ending tag or commit SHA (defaults to `HEAD`).
- `--version <ver>`: Release title version (e.g. `1.1.0`, defaults to `Unreleased`).
- `--write`: Inserts the formatted release section directly into `CHANGELOG.md`.
- `--dry-run`: Prints formatted markdown to stdout without modifying disk (default).
- `--check`: Validates that git commit history parses cleanly with no syntax errors.
- `--help`: Shows CLI usage summary.

---

## 6. Release Flow

When cutting a new release:

1. **Verify commits**: Ensure all commits merged into `main` adhere to Conventional Commits.
2. **Run check**: Execute `npm run changelog:check` to verify all entries parse cleanly.
3. **Generate release notes**: Run `node scripts/generate-changelog.mjs --version 0.2.0 --write` to prepend the release block.
4. **Review diff**: Inspect [`CHANGELOG.md`](../CHANGELOG.md) to confirm all entries, PR links, and contributor mentions are accurate.
5. **Tag and push**: Commit the changelog update and create the git release tag.
