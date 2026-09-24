# Getting started

## 1. Scaffold a manifest from your current work

From the root of a git repository:

```bash
npx specfence init
```

This looks at files already changed on your current branch (committed and
untracked) and writes `.specfence/scope.yaml` with a starting scope bucketed
by top-level directory, plus a visible `ignore:` block for common
lockfiles/build output. If there's nothing changed yet, it writes a
permissive `globs: ["**"]` starter instead of erroring - open it and narrow
it down.

```yaml
version: 1

ignore:
  - "package-lock.json"
  - "**/dist/**"
  # ...

scopes:
  - id: initial
    description: "Auto-generated from files changed on the current branch. Review and edit before committing."
    globs:
      - "src/**"
      - "docs/**"
```

Edit the `globs` lists, split them into more scopes if you want (each
needs a unique `id`), then commit and merge it to your default branch
through a normal, reviewed PR.

**This step matters more than it looks:** SpecFence always reads the
manifest from the base branch, never from a PR's own head - so nothing is
enforced until this file exists on your default branch.

## 2. Add the check to CI

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

That's the whole workflow - no `actions/checkout`, no build step. See
[security.md](security.md) for exactly why, and why the trigger must stay
`pull_request` (never `pull_request_target`).

## 3. Watch it work

Open a PR that touches a file outside every scope's globs. The check fails
with an itemized breakdown in the PR's Job Summary. Open a PR that stays
within scope - it passes. That's the whole product.

## Local dry-runs

You don't need to wait for CI to see a verdict:

```bash
npx specfence check --base origin/main
```

Same manifest, same evaluation logic (`@specfence/core` is shared between
the CLI and the Action - they can't disagree). Useful before pushing, or
for repos that don't want to install the Action at all and just run
`specfence check` as a plain CI script step.

## Closing the one gap the tool can't close for you

Base-ref-pinning the manifest stops a PR from widening its *own* scope. It
does not stop a PR from editing the *workflow file* that enforces it -
that's a human-review problem, not a code problem. Add a
[`CODEOWNERS`](https://docs.github.com/articles/about-code-owners) entry
for `.github/workflows/**` and `.specfence/**`, and require that review in
branch protection with no bypass. See
[security.md](security.md#the-confused-deputy-gap-you-must-close-yourself)
for the full reasoning - this repo uses exactly this setup on itself.
