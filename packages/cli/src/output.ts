import pc from "picocolors";
import type { GateResult, ViolationReason } from "@specfence/core";

interface Meta {
  base: string;
  manifestPath: string;
}

function reasonLabel(reason: ViolationReason): string {
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

export function formatHuman(result: GateResult, meta: Meta): string {
  const lines: string[] = [];

  for (const v of result.violations) {
    lines.push(`${pc.red("✖")} ${v.path}  ${pc.dim(reasonLabel(v.reason))}`);
  }
  for (const c of result.covered) {
    lines.push(`${pc.green("✓")} ${c.path}  ${pc.dim(`in scope: ${c.scopeId}`)}`);
  }

  const color = result.passed ? pc.green : pc.red;
  const summary =
    result.violations.length === 0
      ? `All ${result.covered.length} changed file(s) are within scope (base: ${meta.base}, manifest: ${meta.manifestPath}).`
      : `${result.violations.length} file(s) fell outside the declared scope (base: ${meta.base}, manifest: ${meta.manifestPath}).`;

  lines.push("");
  lines.push(color(summary));
  if (result.mode === "audit" && result.violations.length > 0) {
    lines.push(pc.yellow('Manifest mode is "audit" - these violations are reported but did not fail the check.'));
  }

  return lines.join("\n");
}

export function formatJson(result: GateResult, meta: Meta & { changedFiles: number }): string {
  return JSON.stringify({ ...result, ...meta }, null, 2);
}

export function formatGithubAnnotations(result: GateResult): string {
  if (result.violations.length === 0) return "SpecFence: all changed files are in scope.";
  return result.violations
    .map((v) => `::error file=${v.path}::SpecFence: "${v.path}" is outside the declared scope (${reasonLabel(v.reason)}).`)
    .join("\n");
}
