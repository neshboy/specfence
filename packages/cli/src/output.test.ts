import { describe, expect, it } from "vitest";
import type { GateResult } from "@specfence/core";
import { formatGithubAnnotations } from "./output.js";

function result(violations: GateResult["violations"]): GateResult {
  return { passed: violations.length === 0, mode: "enforce", violations, covered: [], ignored: [] };
}

describe("formatGithubAnnotations", () => {
  it("emits a plain, unescaped annotation for a normal path", () => {
    const out = formatGithubAnnotations(result([{ path: "infra/prod.tf", reason: "not-in-scope" }]));
    expect(out).toBe(
      '::error file=infra/prod.tf::SpecFence: "infra/prod.tf" is outside the declared scope (not covered by any declared scope).'
    );
  });

  it("escapes an embedded newline so it cannot forge a second workflow command", () => {
    // Regression: an unescaped newline followed by "::" would let a
    // malicious PR's file path inject an independent GitHub Actions
    // workflow command (e.g. ::add-mask::) into the log stream.
    const maliciousPath = "evil\n::add-mask::SECRETVALUE";
    const out = formatGithubAnnotations(result([{ path: maliciousPath, reason: "denied" }]));

    expect(out).not.toContain("\n::add-mask::");
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toContain("evil%0A%3A%3Aadd-mask%3A%3ASECRETVALUE");
  });

  it("escapes '%', ':', and ',' in the file= property specifically", () => {
    const out = formatGithubAnnotations(result([{ path: "weird,path:100%done", reason: "denied" }]));
    expect(out).toContain("file=weird%2Cpath%3A100%25done::");
  });

  it("returns a clean message with no violations", () => {
    expect(formatGithubAnnotations(result([]))).toBe("SpecFence: all changed files are in scope.");
  });
});
