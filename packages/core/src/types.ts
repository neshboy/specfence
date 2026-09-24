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
