# SpecFence CLI

Package: **`specfence`** (npm, public). Binary: `specfence`. Source lives in
`packages/cli`; all manifest parsing and scope-matching logic is delegated
to `@specfence/core`, so the CLI and the GitHub Action can never disagree
about a pass/fail verdict - both call the same `checkScope()`.

Guiding principle: **`npx specfence init && npx specfence check` produces a
useful result in a brand-new repo with zero config files and zero flags.**

## Command surface (v1.0)

| Command | Purpose | Can exit 1 (violation)? |
|---|---|:---:|
| `init` | Scaffold `.specfence/scope.yaml` from files changed on the current branch | no |
| `check` | The gate: diff a base ref against HEAD and fail if anything falls outside scope | yes |

`sync` (a human-gated scope-widening helper) and `report` (a shareable HTML
view of a manifest) are real, useful ideas from the design phase but are
**not implemented in v1.0** - see [../CHANGELOG.md](../CHANGELOG.md) and the
roadmap in the main [README](../README.md#roadmap). They are intentionally
left out rather than shipped as non-functional stubs.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Pass, or the manifest isn't adopted yet on the base ref (see below) |
| `1` | A changed file fell outside the declared scope (`check` only) |
| `2` | Usage/config error: bad flags, unresolvable base ref, malformed manifest, git not found, too many changed files to verify safely |

## `specfence check`

Resolves a base ref, reads `.specfence/scope.yaml` **from that base ref
only** (via `git show <base>:<path>`, never from the working tree or HEAD),
diffs `<base>...<head>` with `git diff --raw -M -z`, and calls
`@specfence/core`'s `checkScope()`.

**Base ref resolution**, in order: `--base <ref>` flag → `SPECFENCE_BASE`
env var → `git symbolic-ref refs/remotes/origin/HEAD` (the repo's actual
default branch, usually set after a normal clone) → otherwise **exit 2**
with a message asking you to pass `--base` explicitly. (A from-scratch local
repo like the one this CLI was developed in has no `origin`, so this last
case is common in local testing - that's fine, it's a clear, fast failure
rather than a chain of guesses.)

**Missing vs. malformed manifest** - a deliberate distinction:
- **No `.specfence/scope.yaml` on the base ref at all:** SpecFence isn't
  adopted yet. Prints a notice and **exits 0**.
- **Manifest exists with `scopes: []`:** an explicit deny-all. Every changed
  file is a violation (**exit 1**).
- **Manifest exists but fails to parse, or declares an unsupported
  `version`:** a real error, **exit 2** - never silently treated as a pass.

| Flag | Default | Notes |
|---|---|---|
| `--base <ref>` | auto-resolved (above) | |
| `--head <ref>` | `HEAD` | |
| `--manifest-path <path>` | `.specfence/scope.yaml` | Matches the Action's `manifest-path` input |
| `--json` | off | One JSON document to stdout |
| `--github` | off | Emit `::error file=...::` annotations instead of human output |

```
$ npx specfence check
✖ infra/prod.tf  not covered by any declared scope

2 file(s) fell outside the declared scope (base: origin/main, manifest: .specfence/scope.yaml).
```

## `specfence init`

Scaffolds `.specfence/scope.yaml` from files already changed on the current
branch (`git diff --raw` vs the resolved base, unioned with untracked
files), bucketed by top-level path segment into one scope's glob list, plus
a visible, editable `ignore:` block for common lockfiles/build output.

**Bootstrap case:** if there's nothing to bucket (brand-new repo, clean
branch), `init` does not error - it writes a permissive `globs: ["**"]`
starter manifest with a note that it should be narrowed, so this path never
dead-ends.

| Flag | Default | Notes |
|---|---|---|
| `--base <ref>` | same resolution as `check` | Missing/unresolvable base falls back to untracked-files-only rather than erroring |
| `--out <path>` | `.specfence/scope.yaml` | |
| `--force` | off | Overwrite an existing manifest |
| `--no-default-ignore` | off | Skip seeding the recommended lockfile/build-output `ignore:` block |
| `--dry-run` | off | Print instead of writing |

`init` never exits `1` - there is no violation concept for a scaffolding
command.

## Manifest schema (`version: 1`)

See [../packages/core/src/types.ts](../packages/core/src/types.ts) for the
authoritative types and [security.md](security.md) for the anti-bypass
rationale behind each design choice below.

```yaml
version: 1              # required
mode: enforce            # optional: enforce (default) | audit (report only, never fails)
ignore: []               # optional globs - excluded from the check entirely, as if unchanged
deny: []                 # optional globs - always a violation, cannot be rescued by any scope
scopes:                  # required (may be [] - an explicit deny-all)
  - id: web               # required, unique, kebab-case
    description: "..."     # optional
    globs: ["src/**"]      # required, at least one
    exclude: []             # optional - carves a subtree OUT of this scope's own globs only
```

Evaluation order per changed path: `ignore` → `deny` → `scopes[].globs` minus
that scope's own `exclude` → otherwise a violation. Renamed files are
decomposed into two independent checks (the old path AND the new path must
both pass) so a file can't "launder" scope by round-tripping through a
rename. Deleted files are checked the same as an add/modify. Any changed
path that is a symlink or a submodule pointer bump is **always** a
violation, regardless of glob match, unless its path is explicitly
`ignore`d.

## Contract with `@specfence/core`

The CLI is a thin wrapper: argument parsing, git plumbing
(`packages/cli/src/git.ts`), and output formatting
(`packages/cli/src/output.ts`). Every actual scope decision is made by
`@specfence/core`'s `safeParseManifest()` and `checkScope()` - the same two
functions the Action calls - so there is exactly one place scope semantics
live.
