import { describe, expect, it } from "vitest";
import { checkScope } from "./gate.js";
import { safeParseManifest } from "./manifest.js";
import type { ChangeEntry, ScopeManifest } from "./types.js";
import { ManifestError } from "./types.js";

function manifest(overrides: Partial<ScopeManifest> = {}): ScopeManifest {
  return {
    version: 1,
    mode: "enforce",
    ignore: [],
    deny: [],
    scopes: [],
    ...overrides,
  };
}

function change(path: string, extra: Partial<ChangeEntry> = {}): ChangeEntry {
  return { path, isSymlink: false, isSubmodule: false, ...extra };
}

describe("checkScope", () => {
  it("passes a path covered by a scope's globs", () => {
    const result = checkScope(
      manifest({ scopes: [{ id: "web", globs: ["src/**"], exclude: [] }] }),
      [change("src/index.ts")]
    );
    expect(result.passed).toBe(true);
    expect(result.covered).toEqual([{ path: "src/index.ts", scopeId: "web" }]);
  });

  it("fails a path not covered by any scope", () => {
    const result = checkScope(
      manifest({ scopes: [{ id: "web", globs: ["src/**"], exclude: [] }] }),
      [change("infra/main.tf")]
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([{ path: "infra/main.tf", reason: "not-in-scope" }]);
  });

  it("an empty scopes array is an explicit deny-all", () => {
    const result = checkScope(manifest({ scopes: [] }), [change("anything.ts")]);
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.reason).toBe("not-in-scope");
  });

  it("top-level deny always fails, even if a scope's globs would otherwise cover it", () => {
    const result = checkScope(
      manifest({
        deny: [".github/workflows/**"],
        scopes: [{ id: "everything", globs: ["**"], exclude: [] }],
      }),
      [change(".github/workflows/ci.yml")]
    );
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([{ path: ".github/workflows/ci.yml", reason: "denied" }]);
  });

  it("ignore short-circuits everything, including deny", () => {
    const result = checkScope(
      manifest({ ignore: ["**/*.lock"], deny: ["**/*.lock"], scopes: [] }),
      [change("yarn.lock")]
    );
    expect(result.passed).toBe(true);
    expect(result.ignored).toEqual(["yarn.lock"]);
    expect(result.violations).toEqual([]);
  });

  it("a scope's exclude carves out a subtree from that scope only", () => {
    const result = checkScope(
      manifest({
        scopes: [{ id: "payments", globs: ["services/payments/**"], exclude: ["**/*.generated.ts"] }],
      }),
      [change("services/payments/api.ts"), change("services/payments/client.generated.ts")]
    );
    expect(result.passed).toBe(false);
    expect(result.covered).toEqual([{ path: "services/payments/api.ts", scopeId: "payments" }]);
    expect(result.violations).toEqual([
      { path: "services/payments/client.generated.ts", reason: "not-in-scope" },
    ]);
  });

  it("exclude in one scope does not block a different scope from covering the same path", () => {
    const result = checkScope(
      manifest({
        scopes: [
          { id: "narrow", globs: ["src/**"], exclude: ["src/generated/**"] },
          { id: "generated", globs: ["src/generated/**"], exclude: [] },
        ],
      }),
      [change("src/generated/schema.ts")]
    );
    expect(result.passed).toBe(true);
    expect(result.covered).toEqual([{ path: "src/generated/schema.ts", scopeId: "generated" }]);
  });

  it("decomposes a rename into two independent checks - both must pass", () => {
    const scoped = manifest({ scopes: [{ id: "web", globs: ["src/**"], exclude: [] }] });

    const bothInScope = checkScope(scoped, [change("src/new.ts", { oldPath: "src/old.ts" })]);
    expect(bothInScope.passed).toBe(true);

    const laundering = checkScope(scoped, [change("src/new.ts", { oldPath: "vendor/old.ts" })]);
    expect(laundering.passed).toBe(false);
    expect(laundering.violations).toEqual([{ path: "vendor/old.ts", reason: "not-in-scope" }]);

    const movingOut = checkScope(scoped, [change("vendor/new.ts", { oldPath: "src/old.ts" })]);
    expect(movingOut.passed).toBe(false);
    expect(movingOut.violations).toEqual([{ path: "vendor/new.ts", reason: "not-in-scope" }]);
  });

  it("checks a deleted path the same as an add/modify", () => {
    const result = checkScope(manifest({ scopes: [{ id: "web", globs: ["src/**"], exclude: [] }] }), [
      change("infra/old.tf"),
    ]);
    expect(result.passed).toBe(false);
  });

  it("always flags a symlink as a violation regardless of glob match", () => {
    const result = checkScope(manifest({ scopes: [{ id: "everything", globs: ["**"], exclude: [] }] }), [
      change("src/link", { isSymlink: true }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([{ path: "src/link", reason: "symlink" }]);
  });

  it("always flags a submodule bump as a violation regardless of glob match", () => {
    const result = checkScope(manifest({ scopes: [{ id: "everything", globs: ["**"], exclude: [] }] }), [
      change("vendor/lib", { isSubmodule: true }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.violations).toEqual([{ path: "vendor/lib", reason: "submodule" }]);
  });

  it("an ignored path is exempt even if it is a symlink or submodule", () => {
    const result = checkScope(manifest({ ignore: ["vendor/**"], scopes: [] }), [
      change("vendor/lib", { isSubmodule: true }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.ignored).toEqual(["vendor/lib"]);
  });

  it("audit mode reports violations but never fails the gate", () => {
    const result = checkScope(manifest({ mode: "audit", scopes: [] }), [change("anything.ts")]);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([{ path: "anything.ts", reason: "not-in-scope" }]);
  });

  it("normalizes a trailing-slash glob to mean everything under that directory", () => {
    const result = checkScope(manifest({ ignore: ["dist/"], scopes: [] }), [change("dist/bundle.js")]);
    expect(result.ignored).toEqual(["dist/bundle.js"]);
  });

  it("matches dotfiles and dot-directories (dot:true)", () => {
    const result = checkScope(manifest({ scopes: [{ id: "ci", globs: [".github/**"], exclude: [] }] }), [
      change(".github/workflows/ci.yml"),
    ]);
    expect(result.passed).toBe(true);
  });

  it("matches case-sensitively regardless of host OS", () => {
    const result = checkScope(manifest({ scopes: [{ id: "web", globs: ["src/**"], exclude: [] }] }), [
      change("SRC/index.ts"),
    ]);
    expect(result.passed).toBe(false);
  });
});

describe("safeParseManifest", () => {
  it("parses a minimal valid manifest", () => {
    const m = safeParseManifest("version: 1\nscopes:\n  - id: web\n    globs: ['src/**']\n");
    expect(m.mode).toBe("enforce");
    expect(m.scopes).toEqual([{ id: "web", description: undefined, globs: ["src/**"], exclude: [] }]);
  });

  it("rejects malformed YAML", () => {
    expect(() => safeParseManifest("version: 1\nscopes: [")).toThrow(ManifestError);
  });

  it("rejects a missing version field", () => {
    expect(() => safeParseManifest("scopes: []")).toThrowError(/version/);
  });

  it("rejects an unsupported schema version", () => {
    try {
      safeParseManifest("version: 2\nscopes: []");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestError);
      expect((err as InstanceType<typeof ManifestError>).code).toBe("unsupported-version");
    }
  });

  it("rejects a manifest missing the scopes field", () => {
    expect(() => safeParseManifest("version: 1")).toThrowError(/scopes/);
  });

  it("accepts an explicit empty scopes array", () => {
    const m = safeParseManifest("version: 1\nscopes: []");
    expect(m.scopes).toEqual([]);
  });

  it("rejects a duplicate scope id", () => {
    expect(() =>
      safeParseManifest(
        "version: 1\nscopes:\n  - id: web\n    globs: ['a/**']\n  - id: web\n    globs: ['b/**']\n"
      )
    ).toThrowError(/unique/);
  });

  it("rejects a non-kebab-case scope id", () => {
    expect(() =>
      safeParseManifest("version: 1\nscopes:\n  - id: Web_App\n    globs: ['a/**']\n")
    ).toThrowError(/kebab-case/);
  });

  it("rejects a glob containing a .. path segment", () => {
    expect(() =>
      safeParseManifest("version: 1\nscopes:\n  - id: web\n    globs: ['../escape/**']\n")
    ).toThrowError(/\.\./);
  });

  it("rejects a scope with an empty globs list", () => {
    expect(() => safeParseManifest("version: 1\nscopes:\n  - id: web\n    globs: []\n")).toThrowError(
      /non-empty/
    );
  });

  it("does not hang or crash on anchor/alias amplification ('billion laughs')", () => {
    const bomb =
      "a: &a ['x','x','x','x','x','x','x','x','x']\n" +
      "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\n" +
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\n" +
      "version: 1\nscopes: []\n";
    expect(() => safeParseManifest(bomb)).not.toThrow(/timed out|hang/);
  });
});
