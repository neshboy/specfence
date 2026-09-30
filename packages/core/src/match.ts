import { Minimatch } from "minimatch";

/**
 * minimatch options pinned deliberately (see docs/security.md): dot:true so
 * dotfiles/dot-directories (.github/**, .specfence/**) are matchable at all
 * (by default * and ** don't cross a leading dot), nocase:false
 * unconditionally so matching behaves identically no matter what OS is
 * running the CLI - paths are compared as plain strings from a git diff,
 * never against a real filesystem, so there's no correctness reason to
 * ever go case-insensitive, and the Action always runs on Linux anyway -
 * and nonegate:true so a glob starting with "!" is matched LITERALLY
 * rather than treated as minimatch's global negation. Without this, a
 * manifest author writing the intuitive-looking (but wrong for this tool)
 * `globs: ["src/**", "!src/secrets/**"]` would get a scope that matches
 * almost the ENTIRE repo, since matchesAny is an OR and a negated pattern
 * matches everywhere outside the named subtree. The only supported way to
 * narrow a scope is the schema's own `exclude` field (see manifest.ts,
 * which also rejects a leading "!" outright at parse time as a second,
 * belt-and-suspenders guard).
 */
// noext:true disables extglob syntax (+(...), *(...), ?(...), @(...),
// !(...)) entirely. This schema/docs never document extglob as supported,
// and manifest.ts's validateGlob() ReDoS guard only counts plain */**
// runs per path segment - an extglob quantifier group like "+(a|aa)"
// repeated compiles to an exponential-time regex that sails through that
// guard unbounded (reported wildcardRuns of 0) while still taking minutes
// against an adversarial path. Disabling extglob outright closes this
// rather than trying to bound an ever-growing set of quantifier shapes.
const MATCH_OPTIONS = { dot: true, nocase: false, nonegate: true, noext: true } as const;

/**
 * A bare trailing-slash pattern like "dist/" does not reliably mean
 * "everything under dist/" to minimatch - normalize it to "dist/**" so a
 * manifest behaves the way an author intuitively expects.
 */
function normalizeGlob(glob: string): string {
  return glob.endsWith("/") ? `${glob}**` : glob;
}

// checkScope() (gate.ts) re-runs the same fixed set of manifest globs
// (ignore, deny, and every scope's globs + exclude) against every changed
// path - and again for oldPath on renames - so calling the free-function
// `minimatch(path, glob, options)` per (path, glob) pair recompiles the
// same glob into a brand-new regex on every single call. Cache compiled
// Minimatch instances by their normalized glob string instead, so each
// distinct glob in a manifest is compiled once and reused across every
// path in the run: O(changedFiles x totalGlobs) compilations collapses to
// O(totalGlobs). MATCH_OPTIONS is a fixed module-level constant, so the
// normalized glob string alone is a safe, unambiguous cache key.
const compiledGlobCache = new Map<string, Minimatch>();

function compileGlob(glob: string): Minimatch {
  const normalized = normalizeGlob(glob);
  let compiled = compiledGlobCache.get(normalized);
  if (!compiled) {
    compiled = new Minimatch(normalized, MATCH_OPTIONS);
    compiledGlobCache.set(normalized, compiled);
  }
  return compiled;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => compileGlob(glob).match(path));
}
