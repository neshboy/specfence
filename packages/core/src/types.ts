export type ManifestMode = "enforce" | "audit";

export interface ScopeEntry {
  id: string;
  description?: string;
  globs: string[];
  exclude: string[];
}

export interface ScopeManifest {
  version: 1;
  mode: ManifestMode;
  ignore: string[];
  deny: string[];
  scopes: ScopeEntry[];
}

/**
 * A single changed path, already normalized by the caller's I/O layer
 * (local git for the CLI, the GitHub REST API for the Action) into a
 * path-only, mode-aware shape. The gate engine never touches git, the
 * filesystem, or the network - it only ever sees this.
 */
export interface ChangeEntry {
  path: string;
  /** Present only for renames; both oldPath and path are checked independently. */
  oldPath?: string;
  isSymlink: boolean;
  isSubmodule: boolean;
}

export type ViolationReason =
  | "denied"
  | "not-in-scope"
  | "symlink"
  | "submodule";

export interface Violation {
  path: string;
  reason: ViolationReason;
}

/**
 * Human-readable label for a ViolationReason. Shared here so the CLI
 * (packages/cli/src/output.ts) and the Action (packages/action/src/summary.ts)
 * don't each maintain their own copy of this switch - previously every new
 * ViolationReason needed the same edit made twice in two separate packages.
 * The one cosmetic difference between the two call sites (the Action's
 * markdown wraps `deny` in backticks) is handled at the call site, not here.
 */
export function reasonLabel(reason: ViolationReason): string {
  switch (reason) {
    case "denied":
      return "matches a top-level deny pattern";
    case "symlink":
      return "symlinks are always flagged, regardless of scope";
    case "submodule":
      return "submodule pointer changes are always flagged, regardless of scope";
    case "not-in-scope":
    default:
      return "not covered by any declared scope";
  }
}

export interface CoveredPath {
  path: string;
  scopeId: string;
}

export interface GateResult {
  /** false only when mode is "enforce" and violations is non-empty. */
  passed: boolean;
  mode: ManifestMode;
  violations: Violation[];
  covered: CoveredPath[];
  ignored: string[];
}

export class ManifestError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "malformed-yaml"
      | "invalid-schema"
      | "unsupported-version"
  ) {
    super(message);
    this.name = "ManifestError";
  }
}
