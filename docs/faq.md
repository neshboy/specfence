# FAQ

**Does SpecFence use AI to decide what's in scope?**
No, and deliberately so. The gate is pure `git diff` + glob matching - zero
LLM calls in the decision path. An optional, strictly non-blocking advisory
AI layer was designed during architecture review (see the
[roadmap](../README.md#roadmap)) but is not part of v1.0, and even in a
future version it could never be the thing that decides pass/fail - see
[docs/security.md](security.md) for why that boundary matters.

**Isn't this just CODEOWNERS?**
CODEOWNERS controls *who reviews* a path. SpecFence controls *whether the
change is even allowed*, mechanically, without needing a human to notice a
task drifted out of scope - and it's spec-aware (a manifest describes a
declared scope, not just a path-to-owner map). They're complementary: this
repo uses both (see [.github/CODEOWNERS](../.github/CODEOWNERS)).

**Isn't this just a Danger.js / OPA-style custom CI policy?**
Those need you to hand-write repo-specific policy code with no notion of
"the current task's declared scope" - they're general diff-policy engines.
SpecFence is purpose-built for one thing: does this PR stay inside the
scope it was supposed to touch, with a one-command bootstrap (`specfence
init`) and a schema designed specifically around that question.

**Why not just use an AI PR-review tool like CodeRabbit or PR-Agent?**
Those give advisory, non-deterministic comments - genuinely useful for a
different job (code quality feedback), but they don't hard-block a merge on
a mechanical rule, and re-running them can give a different answer. SpecFence
is deterministic: the same manifest and the same diff always produce the
same verdict.

**Can a PR just widen its own scope to get around this?**
No - the manifest is always read from the PR's *base* ref, never its head.
Editing `.specfence/scope.yaml` in your own PR has zero effect on that PR's
own check. See [docs/security.md](security.md) for the one related gap this
doesn't close (the enforcement workflow itself) and how to close it.

**Does this slow down CI?**
The gate itself is sub-second - it's a diff and a glob match, not a build.
The Action makes a handful of GitHub API calls (manifest + changed files +
two tree listings) rather than checking out the repo at all.

**Does it work on private repos / GitHub Enterprise Server?**
It should work on private github.com repos with no changes. GHES-specific
behavior (particularly around the fork-PR token restrictions this project's
security model leans on) hasn't been independently verified against GHES's
own docs - see the open risk noted in [docs/security.md](security.md).

**What if my team isn't using OpenSpec or spec-kit?**
You don't need either. The MVP manifest format and `specfence init`'s
default generator work from nothing but your current branch's diff - no
external spec-format dependency for v1.0. OpenSpec/spec-kit-aware manifest
generation is a planned v1.1+ enhancement (see the
[roadmap](../README.md#roadmap)), not a requirement today.

**Where do I report a bug or security issue?**
Bugs: [open an issue](https://github.com/neshboy/specfence/issues) (see
[docs/troubleshooting.md](troubleshooting.md) first). Security
vulnerabilities: see [SECURITY.md](../SECURITY.md) - please don't file those
as public issues.
