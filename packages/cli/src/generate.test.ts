import { describe, expect, it } from "vitest";
import { generateFromPaths, renderManifestYaml } from "./generate.js";

describe("generateFromPaths", () => {
  it("produces a permissive bootstrap manifest when there are no changes", () => {
    const generated = generateFromPaths([]);
    expect(generated.bootstrap).toBe(true);
    expect(generated.globs).toEqual(["**"]);
  });

  it("buckets nested paths into a top-level-directory glob", () => {
    const generated = generateFromPaths(["src/index.ts", "src/lib/util.ts", "docs/readme.md"]);
    expect(generated.bootstrap).toBe(false);
    expect(generated.globs).toEqual(["docs/**", "src/**"]);
  });

  it("keeps a root-level file as an exact path, not a glob", () => {
    const generated = generateFromPaths(["README.md"]);
    expect(generated.globs).toEqual(["README.md"]);
  });

  it("dedupes globs from multiple files under the same top-level directory", () => {
    const generated = generateFromPaths(["src/a.ts", "src/b.ts", "src/c/d.ts"]);
    expect(generated.globs).toEqual(["src/**"]);
  });
});

describe("renderManifestYaml", () => {
  it("emits parseable YAML with the expected scope", () => {
    const generated = generateFromPaths(["src/a.ts"]);
    const yaml = renderManifestYaml(generated, true);
    expect(yaml).toContain("version: 1");
    expect(yaml).toContain('- id: initial');
    expect(yaml).toContain('"src/**"');
    expect(yaml).toContain("ignore:");
  });

  it("omits the default ignore block when disabled", () => {
    const generated = generateFromPaths(["src/a.ts"]);
    const yaml = renderManifestYaml(generated, false);
    expect(yaml).not.toContain("ignore:");
  });

  it("escapes embedded quotes in the description", () => {
    const generated = { scopeId: "x", description: 'has "quotes"', globs: ["a/**"], bootstrap: false };
    const yaml = renderManifestYaml(generated, false);
    expect(yaml).toContain('has \\"quotes\\"');
  });
});
