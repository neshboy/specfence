import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkScope, safeParseManifest } from "@specfence/core";
import { assertRefExists, getChangedEntries, getUntrackedFiles, readFileAtRef, resolveDefaultBase } from "./git.js";

/**
 * End-to-end test against a REAL git repository (git itself is not mocked) -
 * this is the part of SpecFence where "does it actually work" matters most,
 * since the design rests on precise git plumbing behavior (raw diff mode
 * bits, rename decomposition, base-ref-pinned reads).
 *
 * Symlink and submodule entries are created via `git update-index
 * --cacheinfo` (pure git-object plumbing) rather than real OS symlinks/
 * submodules, so this test is meaningful on Windows too, where creating an
 * actual filesystem symlink requires elevated privileges.
 */
describe("git.ts against a real repository", () => {
  let repo: string;

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "specfence-git-test-"));
    git(["init", "--quiet"]);
    git(["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.com"]);

    mkdirSync(join(repo, ".specfence"));
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "README.md"), "# test repo\n");
    writeFileSync(join(repo, ".specfence", "scope.yaml"), 'version: 1\nscopes:\n  - id: web\n    globs: ["src/**"]\n');
    // Committed on main itself, so a later rename on `feature` has a real old
    // path to be detected against (rename detection compares the two ENDPOINT
    // trees of the diff, not intermediate history - a file created and
    // renamed within the same feature branch, with no trace of it on main,
    // is not a rename relative to main at all, just a plain add).
    writeFileSync(join(repo, "src", "original.ts"), "export const x = 1;\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "initial"]);

    git(["checkout", "--quiet", "-b", "feature"]);

    mkdirSync(join(repo, "infra"));
    writeFileSync(join(repo, "infra", "bad.tf"), "resource {}\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "add an out-of-scope file"]);

    // A symlink entry (mode 120000), added via plumbing so this works without OS-level symlink support.
    const blobSha = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo,
      input: "src/original.ts",
      encoding: "utf8",
    }).trim();
    git(["update-index", "--add", "--cacheinfo", `120000,${blobSha},src/link-to-original`]);

    // A submodule gitlink entry (mode 160000) - git doesn't need the referenced commit to actually exist locally.
    git(["update-index", "--add", "--cacheinfo", `160000,${"a".repeat(40)},vendor/some-lib`]);
    git(["commit", "--quiet", "-m", "add symlink and submodule bump"]);

    // Rename src/original.ts -> src/renamed.ts (in scope both sides, and now
    // a REAL rename relative to main, since original.ts exists on main).
    git(["mv", "src/original.ts", "src/renamed.ts"]);
    git(["commit", "--quiet", "-m", "rename within scope"]);

    writeFileSync(join(repo, "untracked.txt"), "not committed\n");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("resolveDefaultBase returns undefined when there is no origin remote", () => {
    expect(resolveDefaultBase(repo)).toBeUndefined();
  });

  it("assertRefExists throws for a ref that does not exist", () => {
    expect(() => assertRefExists(repo, "not-a-real-ref")).toThrow();
    expect(() => assertRefExists(repo, "main")).not.toThrow();
  });

  it("readFileAtRef reads the manifest from the base ref", () => {
    const text = readFileAtRef(repo, "main", ".specfence/scope.yaml");
    expect(text).toContain("version: 1");
  });

  it("readFileAtRef returns undefined for a path that does not exist at that ref", () => {
    expect(readFileAtRef(repo, "main", "does/not/exist.yaml")).toBeUndefined();
  });

  it("getChangedEntries reports adds, a symlink, a submodule bump, and a rename with mode-aware flags", () => {
    const entries = getChangedEntries(repo, "main", "feature");
    const byPath = new Map(entries.map((e) => [e.path, e]));

    expect(byPath.get("infra/bad.tf")).toMatchObject({ isSymlink: false, isSubmodule: false });
    expect(byPath.get("src/link-to-original")).toMatchObject({ isSymlink: true, isSubmodule: false });
    expect(byPath.get("vendor/some-lib")).toMatchObject({ isSubmodule: true, isSymlink: false });

    const rename = byPath.get("src/renamed.ts");
    expect(rename).toMatchObject({ path: "src/renamed.ts", oldPath: "src/original.ts", isSymlink: false });
  });

  it("getUntrackedFiles lists a file that was never git-added", () => {
    expect(getUntrackedFiles(repo)).toContain("untracked.txt");
  });

  it("end-to-end: the base-ref manifest correctly gates the feature branch's changes", () => {
    const manifestText = readFileAtRef(repo, "main", ".specfence/scope.yaml");
    expect(manifestText).toBeDefined();
    const manifest = safeParseManifest(manifestText as string);

    const changes = getChangedEntries(repo, "main", "feature");
    const result = checkScope(manifest, changes);

    expect(result.passed).toBe(false);
    const violationPaths = result.violations.map((v) => v.path).sort();
    expect(violationPaths).toEqual(["infra/bad.tf", "src/link-to-original", "vendor/some-lib"]);
    expect(result.covered.map((c) => c.path)).toEqual(
      expect.arrayContaining(["src/renamed.ts", "src/original.ts"])
    );
  });
});
