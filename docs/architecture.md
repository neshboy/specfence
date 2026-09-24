# Architecture

## Why this shape

SpecFence's entire value proposition rests on one guarantee: **a pull
request cannot widen its own permitted scope.** Every architectural choice
below exists to make that guarantee actually hold, not just read well in a
README.

## Components

```
packages/
  core/     Pure manifest parsing + the glob-diff gate engine.
            No git, filesystem, or network access. Both consumers below
            call the SAME checkScope() so they can never disagree.
  cli/      specfence: init, check. Local git plumbing (execFileSync,
            argv-array form - never a shell string) + output formatting.
  action/   The GitHub Action. REST-API-only I/O - no git, no checkout.
```

Only `packages/core` decides pass/fail. The CLI and the Action are both
thin I/O adapters around it (git plumbing vs. the GitHub REST API) - this
is why a local `specfence check` and the Action's verdict can never drift
apart on the same inputs.

## Data flow

**CLI (`specfence check`):**
```
resolve base ref (--base / $SPECFENCE_BASE / origin/HEAD)
  -> git show <base>:.specfence/scope.yaml   (read the manifest, pinned to base)
  -> safeParseManifest()                      (packages/core)
  -> git diff --raw -M -z <base>...<head>     (mode-aware, rename-aware)
  -> checkScope(manifest, changes)            (packages/core)
  -> format + exit code
```

**Action:** the same shape, but every step is a GitHub REST API call
instead of a git command, and it never checks out a single byte of PR
content:

```
GET /repos/{owner}/{repo}/contents/{manifestPath}?ref={pull_request.base.sha}
  -> safeParseManifest()
GET /repos/{owner}/{repo}/pulls/{number}/files   (paginated, capped at 3000)
GET /repos/{owner}/{repo}/git/trees/{head_sha}?recursive=true   (mode lookup: symlink/submodule)
GET /repos/{owner}/{repo}/git/trees/{base_sha}?recursive=true   (mode lookup for removed paths)
  -> checkScope(manifest, changes)
  -> Job Summary + check-run conclusion
```

See [security.md](security.md) for exactly why the Action is built this
way instead of the more obvious `actions/checkout` + run-the-CLI approach.

## The anti-bypass mechanism

The manifest is read from the **base ref** (`pull_request.base.sha` for the
Action, the resolved `--base` for the CLI) - never from the PR's own head.
A PR that edits `.specfence/scope.yaml` to widen its own allowed globs has
zero effect on that PR's own check; the edit only takes effect for PRs
opened *after* it merges, through the same reviewed-PR path as any other
change.

This closes the obvious bypass, but **it is not sufficient on its own** -
see [security.md](security.md#the-confused-deputy-gap-you-must-close-yourself)
for the one gap no code can close by itself (the enforcement workflow
YAML/Action reference is still PR-head-controlled) and the CODEOWNERS +
branch-protection setup that closes it.

## Manifest evaluation order

Per changed path: `ignore` → `deny` → `scopes[].globs` minus that scope's
own `exclude` → otherwise a violation. Renames are decomposed into two
independent checks (old path AND new path) so a file can't "launder" scope
by round-tripping through a rename. See [cli.md](cli.md#manifest-schema-version-1)
for the full schema.

## What's deliberately NOT in the hot path

- **No LLM call.** The gate is pure git-diff + glob matching. An advisory
  AI layer is a real, evaluated idea (see the [roadmap](../README.md#roadmap))
  but is not part of v1.0, and even in a future version it would be
  strictly non-blocking - it could never be the thing that decides pass/fail.
- **No database, no server.** The Action runs statelessly inside GitHub's
  own runner. The CLI reads local git state. There is nothing to host,
  back up, or go down.
- **No plugin loader.** v1.0 ships one built-in "bucket changed paths by
  top-level directory" generator for `init`. A real extensible generator/
  provider interface was designed during architecture review and
  deliberately deferred - see the roadmap.

## Why npm workspaces, not a monolith or a heavier tool

Three packages (`core`/`cli`/`action`) under plain npm workspaces, not
pnpm/Turborepo/Nx. The CLI and the Action have genuinely incompatible
packaging requirements even though they share logic - the CLI is a normal
npm-installed package, the Action must self-bundle into one committed file
with zero install step at use-time - so splitting them is not premature
abstraction, it's the simplest structure that avoids two build pipelines
fighting over one `package.json`. npm workspaces (already bundled with
Node, no extra tool) is enough for a dependency graph this shallow (`core`
is a leaf; `cli`/`action` don't depend on each other).
