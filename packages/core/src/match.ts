import { minimatch } from "minimatch";

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
const MATCH_OPTIONS = { dot: true, nocase: false, nonegate: true } as const;

/**
 * A bare trailing-slash pattern like "dist/" does not reliably mean
 * "everything under dist/" to minimatch - normalize it to "dist/**" so a
 * manifest behaves the way an author intuitively expects.
 */
function normalizeGlob(glob: string): string {
  return glob.endsWith("/") ? `${glob}**` : glob;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => minimatch(path, normalizeGlob(glob), MATCH_OPTIONS));
}
