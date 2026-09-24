# Security model

SpecFence runs inside CI on every incoming pull request, including from
forks. Getting its own trust model wrong would make it a vulnerability in
exactly the category (agentic/automated-PR trust boundaries) it exists to
defend. This document is the honest, complete account of that model -
including the one gap it cannot close by itself.

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Trigger: `pull_request`, never `pull_request_target`

This is the single most important line in any workflow that uses
SpecFence, and the Action's own documentation and examples never show
anything else.

- **`pull_request`**: GitHub gives a fork-originated run **no repo secrets**
  and a `GITHUB_TOKEN` that is forcibly read-only, regardless of what the
  workflow's `permissions:` block requests. The workflow file itself runs
  from the PR's own ref, which is exactly why a contributor can fix their
  own CI - but the blast radius of a fully hostile PR under this trigger is
  bounded to read-only API calls with no write/secret capability.
- **`pull_request_target`**: the workflow YAML always runs from the base
  branch (a PR can't edit it), but the job gets real secrets and whatever
  write permissions are declared, as if it were a push to the base branch -
  *regardless of the PR being from a fork.* This is only safe under strict
  discipline never to check out and execute the PR's own content inside
  that privileged context. The instant something adds `actions/checkout`
  with the PR head ref followed by a build/install/test step, that's the
  canonical "pwn request."

SpecFence's core job - comparing file-path strings against YAML globs -
structurally never needs to execute PR content. That's exactly why
`pull_request_target` is never documented as an option here, not merely
discouraged: `pull_request` is the only trigger under which reintroducing
that failure mode is structurally impossible.

## What the Action actually touches

The Action never calls `actions/checkout`. It never downloads a single
byte of PR-authored file *content* as files on disk. It reads exactly two
pieces of metadata via the GitHub REST API:

1. `.specfence/scope.yaml`'s content, via the Contents API pinned to
   `pull_request.base.sha` (the base commit, never the head).
2. The PR's changed-file list, via the paginated Pulls Files API, plus two
   recursive tree listings (head and base SHA) used only to detect
   symlink/submodule mode bits the Files API doesn't expose.

Recommended workflow permissions (this is what `action.yml`'s own `token`
input assumes):

```yaml
permissions:
  contents: read
  pull-requests: read
```

No write scope is needed. The Action's hard-fail signal is its own job
exit code (a native GitHub Actions status check, no extra permission,
identical behavior for same-repo and fork PRs), and the itemized
violation breakdown is written to the Job Summary (`$GITHUB_STEP_SUMMARY`,
also forks-safe, zero extra permission).

A sticky PR comment or per-file check-run annotations would need write
scopes GitHub forcibly denies to fork-originated `pull_request` runs - the
correct way to get that UX is a second, `workflow_run`-triggered workflow
that only ever reads an uploaded artifact (never PR content) with an
elevated token. This is real, GitHub-endorsed design, but it's a
deliberate v1.1+ item, not part of v1.0 - see the [roadmap](../README.md#roadmap).

## The confused-deputy gap you must close yourself

**No amount of correctly reading `scope.yaml` from the base ref protects
against a PR that edits the *enforcement* itself.** For a `pull_request`
trigger, GitHub runs the workflow YAML from the PR's own head - so a PR
can, in the very same diff, delete the SpecFence step, weaken a failure
into a warning, or point the manifest read at its own head instead of
base. Pinning the *data* to base is moot if the *code that reads it* is
still head-controlled. This is real, and it is the reason SpecFence ships
a [`CODEOWNERS`](../.github/CODEOWNERS) file rather than claiming this is
solved:

- Pin the Action reference by tag or commit SHA in your workflow
  (`uses: neshboy/specfence@v1`, not a local composite action path you
  maintain yourself) - the logic isn't trivially edited even though the
  workflow YAML technically still is.
- Require human review (`CODEOWNERS`) on `.github/workflows/**` and
  `.specfence/**` in your own repo, with branch protection that does not
  allow admin/last-pusher bypass.
- Where available, use org-level required workflows so a repo can't
  disable enforcement at all.

This repo eats its own dog food - see `.github/CODEOWNERS` and
`.specfence/scope.yaml` for exactly this setup applied to SpecFence itself.

## Fail-closed invariants

These are non-negotiable, and covered by regression tests
(`packages/core/src/index.test.ts`):

- A missing manifest on the base ref (confirmed 404 for the Action, a
  confirmed missing path for the CLI) means "not adopted yet" → **pass**.
  Any *other* failure reading it (malformed YAML, an unsupported schema
  version, an API rate limit, a network error) is a **hard error**,
  distinct from both a pass and a normal violation - never silently
  treated as a pass, because that would itself be a bypass vector.
- An empty `scopes: []` is an explicit deny-all, not "unconfigured, allow
  everything."
- A symlink or submodule pointer change is always flagged, regardless of
  glob match, unless its path is explicitly `ignore`d.
- A PR reporting more changed files than the GitHub API could actually
  list (the Files API caps at 3000) fails closed rather than validating a
  truncated list.

## YAML parsing

`safeParseManifest()` (`packages/core/src/manifest.ts`) is the *only*
place manifest text is parsed - every caller goes through it. It uses the
`yaml` npm package's default `parse()`, which has no code-executing custom
tags (unlike legacy `js-yaml` full-loaders) and caps anchor/alias
expansion by default, so a "billion laughs"-style manifest fails fast
rather than hanging or executing anything.

## Glob matching

`minimatch` is pinned to a version with built-in pattern-length guards
against catastrophic backtracking. Matching options are fixed regardless
of host OS: `dot: true` (so `.github/**` is matchable at all) and
case-sensitive matching always (paths are compared as plain strings from a
diff, never against a real filesystem).

## Command execution

The CLI shells out to `git` via `execFileSync` with an argv array
(`packages/cli/src/git.ts`) - never a shell string built by concatenating
a ref name or path. A malicious branch name or filename containing shell
metacharacters cannot break out of the invocation.
