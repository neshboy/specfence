import { describe, expect, it } from "vitest";
import { buildTreeMap, toChangeEntries, type PullFile } from "./github.js";

describe("buildTreeMap", () => {
  it("maps path to mode, skipping entries without both fields", () => {
    const map = buildTreeMap([
      { path: "src/a.ts", mode: "100644", type: "blob" },
      { path: "src/link", mode: "120000", type: "blob" },
      { mode: "100644", type: "blob" },
    ]);
    expect(map.get("src/a.ts")).toBe("100644");
    expect(map.get("src/link")).toBe("120000");
    expect(map.size).toBe(2);
  });
});

describe("toChangeEntries", () => {
  const headTree = buildTreeMap([
    { path: "src/link", mode: "120000" },
    { path: "vendor/lib", mode: "160000" },
    { path: "src/plain.ts", mode: "100644" },
  ]);
  const baseTree = buildTreeMap([{ path: "src/old-link", mode: "120000" }]);

  it("flags a symlink found in the head tree", () => {
    const files: PullFile[] = [{ filename: "src/link", status: "added" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, true);
    expect(entry).toMatchObject({ isSymlink: true, isSubmodule: false });
  });

  it("flags a submodule bump found in the head tree", () => {
    const files: PullFile[] = [{ filename: "vendor/lib", status: "modified" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, true);
    expect(entry).toMatchObject({ isSubmodule: true, isSymlink: false });
  });

  it("for a removed path, looks up mode in the BASE tree, not the head tree", () => {
    const files: PullFile[] = [{ filename: "src/old-link", status: "removed" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, true);
    expect(entry).toMatchObject({ isSymlink: true });
  });

  it("carries previous_filename through as oldPath only for renamed status", () => {
    const files: PullFile[] = [{ filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, true);
    expect(entry).toMatchObject({ path: "src/new.ts", oldPath: "src/old.ts" });
  });

  it("does not treat a copied file's source as oldPath (only renamed does)", () => {
    const files: PullFile[] = [{ filename: "src/copy.ts", previous_filename: "src/orig.ts", status: "copied" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, true);
    expect(entry?.oldPath).toBeUndefined();
  });

  it("skips mode-based flagging entirely when trees were unreliable (truncated)", () => {
    const files: PullFile[] = [{ filename: "src/link", status: "added" }];
    const [entry] = toChangeEntries(files, headTree, baseTree, false);
    expect(entry).toMatchObject({ isSymlink: false, isSubmodule: false });
  });
});
