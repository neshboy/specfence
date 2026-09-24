export type {
  ChangeEntry,
  CoveredPath,
  GateResult,
  ManifestMode,
  ScopeEntry,
  ScopeManifest,
  Violation,
  ViolationReason,
} from "./types.js";
export { ManifestError } from "./types.js";
export { safeParseManifest } from "./manifest.js";
export { checkScope } from "./gate.js";
export { matchesAny } from "./match.js";
