import type { GateResult, ViolationReason } from "@specfence/core";

function reasonLabel(reason: ViolationReason): string {
  switch (reason) {
    case "denied":
      return "matches a top-level `deny` pattern";
    case "symlink":
      return "symlinks are always flagged, regardless of scope";
    case "submodule":
      return "submodule pointer changes are always flagged, regardless of scope";
    case "not-in-scope":
    default:
      return "not covered by any declared scope";
  }
}

export interface SummaryMeta {
  manifestPath: string;
  baseSha: string;
  treesReliable: boolean;
}

/** Pure markdown builder so this is testable without @actions/core's runner-only summary API. */
export function buildSummaryMarkdown(result: GateResult, meta: SummaryMeta): string {
  const lines: string[] = ["## SpecFence"];

  lines.push(
    result.passed
      ? `✅ All changed files are within the scope declared in \`${meta.manifestPath}\` (base \`${meta.baseSha.slice(0, 7)}\`).`
      : `❌ ${result.violations.length} file(s) fell outside the scope declared in \`${meta.manifestPath}\` (base \`${meta.baseSha.slice(0, 7)}\`).`
  );

  if (result.mode === "audit" && result.violations.length > 0) {
    lines.push('_Manifest mode is `audit` - these violations were reported but did not fail the check._');
  }
  if (!meta.treesReliable) {
    lines.push(
      "_Note: this repository's file tree was too large to fully verify symlink/submodule status this run - path/glob scope checking above is unaffected._"
    );
  }

  if (result.violations.length > 0) {
    lines.push("", "| File | Reason |", "| --- | --- |");
    for (const v of result.violations) {
      lines.push(`| \`${v.path}\` | ${reasonLabel(v.reason)} |`);
    }
  }

  if (result.covered.length > 0) {
    lines.push("", "<details><summary>In-scope files</summary>", "", "| File | Scope |", "| --- | --- |");
    for (const c of result.covered) {
      lines.push(`| \`${c.path}\` | \`${c.scopeId}\` |`);
    }
    lines.push("", "</details>");
  }

  return lines.join("\n");
}

export function buildNotAdoptedMarkdown(manifestPath: string): string {
  return [
    "## SpecFence",
    "",
    `No \`${manifestPath}\` found on the base branch - nothing is enforced yet.`,
    "",
    "Run `npx specfence init` to scaffold one from your current branch's changes, then merge it as a normal, reviewed PR.",
  ].join("\n");
}
