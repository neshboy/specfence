import { matchesAny } from "./match.js";
import type { ChangeEntry, CoveredPath, GateResult, ScopeManifest, Violation } from "./types.js";

type PathVerdict =
  | { kind: "ignored" }
  | { kind: "covered"; scopeId: string }
  | { kind: "violation"; reason: "denied" | "not-in-scope" };

/**
 * Evaluation order per path: ignore -> deny -> scopes[].globs minus that
 * scope's own exclude -> otherwise a violation. `ignore` short-circuits
 * everything else (a path we don't care about at all), `deny` cannot be
 * rescued by any scope, and `exclude` only cancels its OWN scope entry's
 * contribution (a different scope may still cover the same path).
 */
function evaluatePath(path: string, manifest: ScopeManifest): PathVerdict {
  if (matchesAny(path, manifest.ignore)) return { kind: "ignored" };
  if (matchesAny(path, manifest.deny)) return { kind: "violation", reason: "denied" };
  for (const scope of manifest.scopes) {
    if (matchesAny(path, scope.globs) && !matchesAny(path, scope.exclude)) {
      return { kind: "covered", scopeId: scope.id };
    }
  }
  return { kind: "violation", reason: "not-in-scope" };
}

/**
 * The gate. Pure function: no git, filesystem, or network access - callers
 * (the CLI via local git, the Action via the GitHub REST API) are
 * responsible for turning their own diff source into ChangeEntry[].
 *
 * Renames are decomposed into two independent path checks (old path AND
 * new path both must pass) rather than checking only one side - see
 * docs/security.md for why ("scope laundering" via rename otherwise).
 * Symlink/submodule mode is checked only on the current (`path`) side,
 * since that's the only side git actually reports a mode for; a symlink or
 * submodule entry is a violation unconditionally, UNLESS its path is
 * explicitly `ignore`d (ignore means "don't care about this path at all",
 * which should hold regardless of what kind of path it is).
 */
export function checkScope(manifest: ScopeManifest, changes: readonly ChangeEntry[]): GateResult {
  const violations: Violation[] = [];
  const covered: CoveredPath[] = [];
  const ignored: string[] = [];

  for (const change of changes) {
    const verdict = evaluatePath(change.path, manifest);
    if (verdict.kind === "ignored") {
      ignored.push(change.path);
    } else if (change.isSymlink) {
      violations.push({ path: change.path, reason: "symlink" });
    } else if (change.isSubmodule) {
      violations.push({ path: change.path, reason: "submodule" });
    } else if (verdict.kind === "violation") {
      violations.push({ path: change.path, reason: verdict.reason });
    } else {
      covered.push({ path: change.path, scopeId: verdict.scopeId });
    }

    if (change.oldPath !== undefined) {
      const oldVerdict = evaluatePath(change.oldPath, manifest);
      if (oldVerdict.kind === "ignored") {
        ignored.push(change.oldPath);
      } else if (oldVerdict.kind === "violation") {
        violations.push({ path: change.oldPath, reason: oldVerdict.reason });
      } else {
        covered.push({ path: change.oldPath, scopeId: oldVerdict.scopeId });
      }
    }
  }

  return {
    passed: manifest.mode === "audit" || violations.length === 0,
    mode: manifest.mode,
    violations,
    covered,
    ignored,
  };
}
