<div align="center">

<img src="docs/assets/logo.svg" alt="SpecFence" width="72" height="72" />

# SpecFence

**Hard-fail a PR the instant a changed file falls outside its declared scope.**

[![CI](https://github.com/neshboy/specfence/actions/workflows/ci.yml/badge.svg)](https://github.com/neshboy/specfence/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/specfence)](https://www.npmjs.com/package/specfence)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-SpecFence-blue)](https://github.com/marketplace/actions/specfence)

[Getting started](docs/getting-started.md) ·
[Architecture](docs/architecture.md) ·
[Security model](docs/security.md) ·
[FAQ](docs/faq.md)

</div>

---

AI coding agents (and humans) drift. A PR asked to fix one bug ends up
touching an unrelated config file, adding a dependency nobody requested, or
quietly changing behavior nobody reviewed for that change. Catching this
today means a human has to *notice* it during review - slow, inconsistent,
and it gets worse exactly as agent-authored PR volume goes up.

SpecFence turns "did this PR stay on task?" from a review question into a
mechanical CI check: a **deterministic** GitHub Action + CLI that diffs a
PR's changed files against a versioned scope manifest and fails the check
the instant something falls outside it - with the itemized reason, right in
the PR.

```
✖ infra/prod.tf  not covered by any declared scope

1 file(s) fell outside the declared scope (base: origin/main, manifest: .specfence/scope.yaml).
```

## Why SpecFence, not X

| | SpecFence | CODEOWNERS / path-filter actions | AI PR-review bots (CodeRabbit, PR-Agent, ...) |
|---|---|---|---|
| Deterministic (same input → same verdict) | ✅ | ✅ | ❌ (LLM-based, advisory) |
| Hard-blocks the merge | ✅ | ✅ (via review requirement) | ❌ (comments only) |
| Aware of a declared *task scope*, not just file→owner | ✅ | ❌ | partially |
| Can't be bypassed by widening scope in the same PR | ✅ (base-ref pinned) | n/a | n/a |
| Zero infra, zero LLM cost | ✅ | ✅ | ❌ |

See [docs/faq.md](docs/faq.md) for the fuller comparison, including the one
thing SpecFence's manifest-pinning *can't* fix by itself (and how to close
it with CODEOWNERS - this repo does exactly that on itself).

## How it works

1. `.specfence/scope.yaml` declares one or more named scopes, each a list of
   glob patterns, committed to your default branch.
2. On every PR, SpecFence reads that manifest from the **base** branch -
   never from the PR's own head - and diffs the PR's changed files against
   it.
3. Anything outside every declared scope fails the check, with an itemized
   breakdown in the PR's Job Summary. Renamed files are checked on both
   their old and new path; symlinks and submodule bumps are always flagged.

Because the manifest is read from the base branch, a PR can't widen its own
allowed scope to sneak something through - editing `.specfence/scope.yaml`
only takes effect for PRs opened *after* that edit merges, through the same
reviewed-PR path as any other change. See [docs/architecture.md](docs/architecture.md)
and [docs/security.md](docs/security.md) for the full design and its one
honest limitation.

## Quick start

```bash
npx specfence init
```

Scaffolds `.specfence/scope.yaml` from files already changed on your current
branch. Commit it and merge to your default branch, then add the check:

```yaml
# .github/workflows/specfence.yml
name: SpecFence
on:
  pull_request:
permissions:
  contents: read
  pull-requests: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: neshboy/specfence@v1
```

No `actions/checkout`, no build step - the Action never checks out or
executes a single byte of PR content, only reads two pieces of metadata via
the GitHub REST API. See [docs/getting-started.md](docs/getting-started.md)
for the full walkthrough, and [docs/security.md](docs/security.md) for
exactly why the trigger must stay `pull_request` and never
`pull_request_target`.

Prefer to run it locally / outside the Action?

```bash
npx specfence check --base origin/main
```

Same manifest, same `@specfence/core` evaluation logic the Action uses -
they can't disagree.

## Manifest example

```yaml
version: 1

ignore:
  - "**/*.lock"
  - "**/dist/**"

deny:
  - ".github/workflows/**"   # never allowed, no matter what any scope claims

scopes:
  - id: payments-service
    description: "Payments microservice: API, business logic, its own tests."
    globs:
      - "services/payments/**"
    exclude:
      - "services/payments/**/*.generated.ts"

  - id: docs
    globs:
      - "docs/**"
      - "**/*.md"
```

Full schema, evaluation order, and the rename/symlink/submodule rules:
[docs/cli.md](docs/cli.md#manifest-schema-version-1).

## Architecture

```
packages/core     manifest schema + deterministic glob-diff gate engine
                   (pure - no git, filesystem, or network access)
packages/cli      specfence: init, check  (local git plumbing)
packages/action   the GitHub Action        (REST API only, no checkout)
```

Both the CLI and the Action call the same `checkScope()` in `packages/core`
- they can never disagree on a verdict. Full write-up:
[docs/architecture.md](docs/architecture.md).

## Privacy

Nothing leaves your machine or your own GitHub org's API boundary. The CLI
is purely local git plumbing. The Action makes exactly two kinds of GitHub
REST calls (read the manifest from a specific commit, list a PR's changed
files) - no third-party service, no telemetry, no AI call anywhere in v1.0.

## Documentation

- [Getting started](docs/getting-started.md)
- [CLI reference](docs/cli.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [FAQ](docs/faq.md)

## Roadmap

**v1.1**
- OpenSpec / spec-kit-aware manifest generation (`specfence init` deriving
  scopes directly from a `changes/<id>/proposal.md` or `specs/` convention).
- A human-gated scope-widening workflow (a dedicated PR label/template that
  makes expanding the manifest itself an explicitly audited change, beyond
  plain code review).
- The `workflow_run` + artifact pattern for a sticky PR comment / per-file
  check-run annotations on fork PRs (deferred from v1.0 - see
  [docs/security.md](docs/security.md) for why this needs a second,
  more-privileged workflow rather than just widening the main one's
  permissions).

**v1.2**
- Optional, strictly non-blocking advisory AI layer (provider-agnostic:
  Anthropic/OpenAI/Ollama/none) that can flag likely *behavioral* scope
  drift as commentary - never part of the pass/fail decision. Designed
  during architecture review, deliberately deferred until the deterministic
  core has real usage.
- A shareable, static HTML scope-vs-diff report (no hosted backend).

**v2.0**
- A generator plugin interface for community-contributed spec-format
  parsers (ADRs, RFCs, org-specific conventions), gated behind a stable
  `@specfence/core` API - the maintainability review during architecture
  design flagged building this before the deterministic gate existed as
  premature, so it's explicitly parked until there's real demand.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repo enforces its own
`.specfence/scope.yaml` on every PR, and requires review on
`.github/workflows/**`/`.specfence/**` via [CODEOWNERS](.github/CODEOWNERS) -
see [docs/security.md](docs/security.md) for why.

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability, and
[docs/security.md](docs/security.md) for the full trust model.

## License

[MIT](LICENSE)
