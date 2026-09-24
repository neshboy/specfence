# Security Policy

SpecFence runs inside CI on every pull request, including from forks — so its
own security posture matters more than a typical CLI tool. See
[docs/security.md](docs/security.md) for the trust model (what SpecFence does
and does not do with fork PRs, tokens, and the base-ref scope manifest).

## Supported Versions

Only the latest published `1.x` release of the `specfence` npm package and the
latest major tag of the Action (`neshboy/specfence@v1`) receive security
fixes. Pin the Action to a major version tag, not a commit SHA or `@main`, to
receive patched releases automatically.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](../../security/advisories) of this repository.
2. Click **"Report a vulnerability"**.
3. Include reproduction steps, the affected version, and impact.

We aim to acknowledge reports within 5 business days and to publish a fix or
mitigation plan within 30 days of confirming a valid report. Credit is given
in the release notes unless you request otherwise.

## Scope

In scope: the `specfence` CLI, the `packages/core` diff/glob engine, the
GitHub Action (`action.yml` and its bundled `dist/`), and the optional
advisory-provider plugin interface.

Out of scope: vulnerabilities in third-party AI providers you configure for
the optional advisory layer, and misconfiguration of your own workflow
permissions (see [docs/security.md](docs/security.md) for the permissions we
recommend).
