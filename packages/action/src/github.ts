import type { ChangeEntry } from "@specfence/core";

// Minimal shapes for exactly the octokit fields this module reads - keeps
// the pure conversion logic (toChangeEntries) unit-testable without a real
// octokit client or network access.
export interface PullFile {
  filename: string;
  previous_filename?: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
}

export interface TreeEntry {
  path?: string;
  mode?: string;
  type?: string;
}

export type TreeMap = Map<string, string>;

export function buildTreeMap(entries: TreeEntry[]): TreeMap {
  const map: TreeMap = new Map();
  for (const entry of entries) {
    if (entry.path !== undefined && entry.mode !== undefined) map.set(entry.path, entry.mode);
  }
  return map;
}

/**
 * Converts the GitHub REST API's per-file PR diff shape into SpecFence's
 * git-agnostic ChangeEntry[]. Mode (symlink 120000 / submodule 160000)
 * comes from separately-fetched recursive tree listings (head tree for
 * added/modified/renamed paths, base tree for removed paths, since a
 * removed path's mode can't be read from the tree it was removed from) -
 * the Pulls Files API itself does not expose file mode.
 *
 * If either tree was truncated by GitHub (very large repos), mode-based
 * detection is skipped for this run rather than guessed at - the caller
 * is expected to surface that as a visible warning, not a silent gap.
 */
export function toChangeEntries(
  files: PullFile[],
  headTreeMap: TreeMap,
  baseTreeMap: TreeMap,
  treesReliable: boolean
): ChangeEntry[] {
  return files.map((file) => {
    const path = file.filename;
    const oldPath = file.status === "renamed" ? file.previous_filename : undefined;
    const modeSourceMap = file.status === "removed" ? baseTreeMap : headTreeMap;
    const mode = treesReliable ? modeSourceMap.get(path) : undefined;
    return {
      path,
      oldPath,
      isSymlink: mode === "120000",
      isSubmodule: mode === "160000",
    };
  });
}
