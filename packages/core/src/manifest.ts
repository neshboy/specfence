import { parse as parseYaml } from "yaml";
import { ManifestError, type ManifestMode, type ScopeEntry, type ScopeManifest } from "./types.js";

const SUPPORTED_VERSION = 1;
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface ParseManifestOptions {
  /** Where the manifest text came from, used only for error messages. */
  source?: string;
}

/**
 * The only place `.specfence/scope.yaml` text is ever turned into a
 * ScopeManifest. Every caller (CLI, Action, generators, tests) MUST go
 * through this function rather than calling `yaml.parse` directly - this
 * is enforced by an eslint import-restriction rule, not just convention.
 *
 * Safe by construction: the `yaml` package's default parse() has no
 * code-executing custom tags (unlike legacy js-yaml full-loaders) and caps
 * alias/anchor expansion by default, so a "billion laughs" style manifest
 * fails fast with a parse error instead of hanging or executing anything.
 */
export function safeParseManifest(text: string, options: ParseManifestOptions = {}): ScopeManifest {
  const label = options.source ? ` in ${options.source}` : "";

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ManifestError(`Could not parse YAML${label}: ${(err as Error).message}`, "malformed-yaml");
  }

  if (raw === null || raw === undefined) {
    throw new ManifestError(`Manifest${label} is empty.`, "invalid-schema");
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError(`Manifest${label} must be a YAML mapping at the top level.`, "invalid-schema");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== "number" || !Number.isInteger(obj.version)) {
    throw new ManifestError(`Manifest${label} is missing a required integer "version" field.`, "invalid-schema");
  }
  if (obj.version !== SUPPORTED_VERSION) {
    throw new ManifestError(
      `Manifest${label} declares version ${obj.version}, but this build of SpecFence only supports version ${SUPPORTED_VERSION}. Upgrade the specfence CLI/Action, or downgrade the manifest.`,
      "unsupported-version"
    );
  }

  const mode = parseMode(obj.mode, label);
  const ignore = parseGlobList(obj.ignore, "ignore", label);
  const deny = parseGlobList(obj.deny, "deny", label);
  const scopes = parseScopes(obj.scopes, label);

  return { version: 1, mode, ignore, deny, scopes };
}

function parseMode(value: unknown, label: string): ManifestMode {
  if (value === undefined) return "enforce";
  if (value === "enforce" || value === "audit") return value;
  throw new ManifestError(
    `Manifest${label} has an invalid "mode" (${JSON.stringify(value)}); expected "enforce" or "audit".`,
    "invalid-schema"
  );
}

function parseGlobList(value: unknown, field: string, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new ManifestError(`Manifest${label} field "${field}" must be a list of glob strings.`, "invalid-schema");
  }
  value.forEach((glob) => validateGlob(glob, field, label));
  return value as string[];
}

function parseScopes(value: unknown, label: string): ScopeEntry[] {
  if (value === undefined) {
    throw new ManifestError(
      `Manifest${label} is missing the required "scopes" field (use "scopes: []" to explicitly deny everything).`,
      "invalid-schema"
    );
  }
  if (!Array.isArray(value)) {
    throw new ManifestError(`Manifest${label} field "scopes" must be a list.`, "invalid-schema");
  }

  const seenIds = new Set<string>();
  return value.map((entry, index) => parseScopeEntry(entry, index, label, seenIds));
}

function parseScopeEntry(entry: unknown, index: number, label: string, seenIds: Set<string>): ScopeEntry {
  const where = `scopes[${index}]${label}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new ManifestError(`${where} must be a mapping.`, "invalid-schema");
  }
  const obj = entry as Record<string, unknown>;

  if (typeof obj.id !== "string" || !ID_PATTERN.test(obj.id)) {
    throw new ManifestError(
      `${where} has an invalid "id" (${JSON.stringify(obj.id)}); expected a kebab-case string matching ${ID_PATTERN}.`,
      "invalid-schema"
    );
  }
  if (seenIds.has(obj.id)) {
    throw new ManifestError(`${where} reuses scope id "${obj.id}", which must be unique.`, "invalid-schema");
  }
  seenIds.add(obj.id);

  if (obj.description !== undefined && typeof obj.description !== "string") {
    throw new ManifestError(`${where} field "description" must be a string.`, "invalid-schema");
  }

  if (!Array.isArray(obj.globs) || obj.globs.length === 0 || !obj.globs.every((g) => typeof g === "string")) {
    throw new ManifestError(`${where} field "globs" must be a non-empty list of glob strings.`, "invalid-schema");
  }
  obj.globs.forEach((g) => validateGlob(g as string, `scopes[${index}].globs`, label));

  const excludeRaw = obj.exclude === undefined ? [] : obj.exclude;
  if (!Array.isArray(excludeRaw) || !excludeRaw.every((g) => typeof g === "string")) {
    throw new ManifestError(`${where} field "exclude" must be a list of glob strings.`, "invalid-schema");
  }
  excludeRaw.forEach((g) => validateGlob(g as string, `scopes[${index}].exclude`, label));

  return {
    id: obj.id,
    description: obj.description as string | undefined,
    globs: obj.globs as string[],
    exclude: excludeRaw as string[],
  };
}

function validateGlob(glob: string, field: string, label: string): void {
  if (glob.length === 0) {
    throw new ManifestError(`Manifest${label} has an empty glob pattern in "${field}".`, "invalid-schema");
  }
  if (glob.split(/[\\/]/).includes("..")) {
    throw new ManifestError(
      `Manifest${label} glob "${glob}" in "${field}" contains a ".." path segment, which is not allowed.`,
      "invalid-schema"
    );
  }
  if (glob.includes("\\")) {
    throw new ManifestError(
      `Manifest${label} glob "${glob}" in "${field}" uses a backslash; glob patterns must use forward slashes.`,
      "invalid-schema"
    );
  }
}
