# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

- `specfence` (the CLI, `packages/cli`) is the only package changesets
  actually publishes to npm - add a changeset (`npx changeset`) for any PR
  that changes CLI-user-visible behavior.
- `@specfence/core` and `@specfence/action` are `"private": true` and listed
  in `ignore` above, so changesets will never try to publish them or ask for
  a changeset on their behalf. `@specfence/action` still gets versioned and
  released, but via a git tag + GitHub Release (see
  `.github/workflows/release.yml`), not via `npm publish` - that's what
  GitHub Marketplace consumes.

Read the [intro to changesets](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
for the full guide.
