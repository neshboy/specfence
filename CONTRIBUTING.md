# Contributing to SpecFence

Thanks for considering it. This is a young project with a small, deliberately
simple architecture - read [docs/architecture.md](docs/architecture.md)
first, it explains the "why" behind the package split and should make the
codebase click quickly.

## Development setup

```bash
git clone https://github.com/neshboy/specfence.git
cd specfence
npm install
npm run build   # required once before tests - see below
npm test
```

`packages/cli`'s tests import the *published* `@specfence/core` entry point
(its `package.json` "exports" field), which only exists after a build -
`npm test` runs a `pretest` hook that builds `@specfence/core` automatically,
but a full `npm run build` (all three packages) is worth running once up
front so `packages/action/dist` also reflects your changes.

```bash
npm run typecheck   # tsc -b across all three packages
npm run build       # core -> cli + action (order matters, core is a dependency)
npm test            # vitest, all packages
```

## Project layout

- `packages/core` - manifest parsing + the glob-diff gate engine. Pure: no
  git, filesystem, or network access. This is where scope-matching bugs get
  fixed; both the CLI and the Action call the same `checkScope()`.
- `packages/cli` - the `specfence` npm package. Git plumbing lives in
  `packages/cli/src/git.ts` (argv-array `execFileSync`, never a shell
  string).
- `packages/action` - the GitHub Action. REST-API-only I/O
  (`packages/action/src/github.ts`). If you change this package's source,
  you must rebuild and commit the bundle - see below.

## If you touch `packages/action/src/**`

`packages/action/dist/index.cjs` is a committed, pre-built bundle (GitHub
Actions can't run `npm install` at use-time, so the bundle has to already be
in the repo). CI has a step that rebuilds it and fails if that produces a
diff from what you committed. Before opening a PR:

```bash
npm run build -w @specfence/action
git add packages/action/dist
```

## Tests

Real behavior is tested against real git repositories and, for the Action's
pure logic, real fixture data - see `packages/cli/src/git-integration.test.ts`
for the pattern (it creates a real temp repo, makes real commits, including
symlink/submodule entries via `git update-index --cacheinfo` plumbing so it
works without OS-level symlink privileges). Please follow this pattern for
new tests rather than mocking git.

## Anti-bypass changes need extra scrutiny

Anything touching `packages/core/src/gate.ts` or the base-ref-pinning logic
in `packages/cli/src/git.ts` / `packages/action/src/index.ts` is the
project's actual security boundary - see
[docs/security.md](docs/security.md). Please describe in your PR which
fail-closed invariant (if any) your change interacts with, and add a
regression test for it.

## Scope

This repo enforces its own `.specfence/scope.yaml` on every PR (see
[.github/workflows/specfence.yml](.github/workflows/specfence.yml)) - if your
PR fails that check, it's telling you which area you touched; that's
expected and not a bug in your contribution.

## Commit style

No strict convention enforced yet - a clear, present-tense summary line is
fine. `npm run changeset` (via `npx changeset`) if your change should ship a
version bump to the `specfence` npm package or the Action - see
[.changeset/README.md](.changeset/README.md).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
