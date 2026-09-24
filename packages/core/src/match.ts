import { minimatch } from "minimatch";

/**
 * minimatch options pinned deliberately (see docs/security.md): dot:true so
 * dotfiles/dot-directories (.github/**, .specfence/**) are matchable at all
 * (by default * and ** don't cross a leading dot), and nocase:false
 * unconditionally so matching behaves identically no matter what OS is
 * running the CLI - paths are compared as plain strings from a git diff,
 * never against a real filesystem, so there's no correctness reason to
 * ever go case-insensitive, and the Action always runs on Linux anyway.
 */
const MATCH_OPTIONS = { dot: true, nocase: false } as const;

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
