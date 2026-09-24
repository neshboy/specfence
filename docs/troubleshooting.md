# Troubleshooting

### "No .specfence/scope.yaml found on `<base>` - SpecFence isn't enforcing anything yet"

This is not an error - it's SpecFence telling you the manifest doesn't
exist on the base branch yet. Run `npx specfence init`, commit the result,
and merge it to your default branch first. Nothing is enforced until the
manifest exists *there*, by design - see
[getting-started.md](getting-started.md).

### My PR keeps failing even though I only touched files I expected to be in scope

Check whether the file was **renamed**. SpecFence checks both the old and
new path of a rename independently - if the file's *old* path (before your
PR) wasn't already covered by a scope, the rename itself is a violation,
even though the new path looks fine. This is deliberate (see
[security.md](security.md)) - it stops a file from "laundering" its way
into an unrelated scope via a rename. Add the old path's location to a
scope, or don't rename across scope boundaries in the same PR.

### The check passed on my PR, but I later found out the workflow file itself was edited by a contributor

This is the one thing SpecFence's manifest-pinning cannot fix by itself -
see
[security.md#the-confused-deputy-gap-you-must-close-yourself](security.md#the-confused-deputy-gap-you-must-close-yourself).
Add `CODEOWNERS` protection and branch-protection rules for
`.github/workflows/**` and `.specfence/**`, with no admin/last-pusher
bypass.

### `specfence check` says "could not determine a base ref"

The CLI's base-ref auto-detection relies on `origin/HEAD` being set (true
after a normal `git clone`). A repo with no `origin` remote, or a
locally-initialized repo that was never cloned, won't have this. Pass
`--base` explicitly (e.g. `--base main` or `--base origin/main`), or set
the `SPECFENCE_BASE` environment variable.

### "git was not found on PATH"

The CLI shells out to your local `git` installation for `check`/`init`. It
doesn't bundle its own git. Install git and make sure it's on `PATH`. (The
GitHub Action does not have this dependency - it uses the REST API, not
git, and needs no `actions/checkout` step at all.)

### The Action says "this PR reports N changed files but only M could be listed"

GitHub's Pull Request Files API caps out at 3000 files regardless of
pagination. SpecFence fails closed rather than validate a possibly-
truncated list. If you genuinely have PRs this large, they almost
certainly shouldn't be reviewed as one unit regardless of what SpecFence
says - but if this is a real, recurring need, open an issue.

### A dependency-bump PR (lockfile-only) keeps failing

Lockfiles aren't ignored by default in a manifest you write by hand -
`specfence init` seeds a recommended `ignore:` block for common lockfiles
and build output, but if you wrote your manifest from scratch, add the
relevant patterns yourself (see the example in
[cli.md](cli.md#manifest-schema-version-1)).

### Still stuck?

Open an issue with the exact command you ran, your `.specfence/scope.yaml`
(redact anything sensitive), and the output of the same command with
`--json` if you were using `check`. See [../CONTRIBUTING.md](../CONTRIBUTING.md).
