import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * End-to-end tests against the REAL BUILT CLI BINARY (not the in-process
 * git.ts functions) - these specifically regression-test bugs that only
 * manifest at the process boundary (stderr leakage from a child process,
 * an error message the CLI prints to its own stderr). Requires
 * `npm run build -w specfence` to have already produced dist/index.cjs -
 * see CONTRIBUTING.md.
 */
const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.cjs");

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

describe.skipIf(!existsSync(CLI_PATH))("cli binary regressions (requires a prior `npm run build`)", () => {
  let repo: string;

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  // A FRESH repo per test - these tests each build their own commit
  // history, and reusing one repo across tests (even with branch cleanup)
  // left earlier tests' commits reachable from `main`, corrupting later
  // tests' "no manifest yet" assumptions.
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "specfence-cli-bin-test-"));
    git(["init", "--quiet"]);
    git(["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(["config", "user.name", "Test"]);
    git(["config", "user.email", "test@example.com"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("stays fail-closed when the base-ref manifest's deny glob is corrupted by a single invalid UTF-8 byte", () => {
    // This is the confirmed regression: a lone 0xFF byte spliced into a
    // `deny` glob used to be silently replaced with U+FFFD, mutating the
    // glob into something that could never match, and letting a denied
    // change through with exit 0 / passed:true.
    mkdirSync(join(repo, ".specfence"), { recursive: true });
    mkdirSync(join(repo, "secrets"), { recursive: true });
    writeFileSync(join(repo, "README.md"), "clean baseline\n");

    const cleanGlob = Buffer.from('version: 1\nmode: enforce\nscopes:\n  - id: main\n    globs: ["**"]\ndeny:\n  - "secrets');
    const corruptGlob = Buffer.concat([cleanGlob, Buffer.from([0xff]), Buffer.from('/**"\n')]);
    writeFileSync(join(repo, ".specfence", "scope.yaml"), corruptGlob);
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "corrupted deny glob"], { cwd: repo });

    execFileSync("git", ["checkout", "--quiet", "-b", "feature"], { cwd: repo });
    writeFileSync(join(repo, "secrets", "config.txt"), "should never be allowed through\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "add a file that must be denied"], { cwd: repo });

    const result = runCli(["check", "--base", "main", "--json"], repo);

    // Must NOT be the pre-fix bypass (exit 0 / passed:true) - either a
    // clean deny-violation (if decoding degrades gracefully enough to still
    // parse) or, correctly, a hard decode error (exit 2). Either is
    // fail-closed; silently passing is the only unacceptable outcome.
    expect(result.status).not.toBe(0);
    if (result.status === 1) {
      const parsed = JSON.parse(result.stdout);
      expect(parsed.passed).toBe(false);
    }
  });

  it("prints no raw git stderr on the common, entirely-expected 'manifest not adopted yet' path", () => {
    writeFileSync(join(repo, "README.md"), "no manifest committed at all\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "init, no .specfence/scope.yaml"], { cwd: repo });
    execFileSync("git", ["checkout", "--quiet", "-b", "feature"], { cwd: repo });
    writeFileSync(join(repo, "a.txt"), "x\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "a change"], { cwd: repo });

    const result = runCli(["check", "--base", "main"], repo);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("isn't enforcing anything yet");
    expect(result.stderr).toBe("");
  });

  it("names the real problem when --base points at a ref that does not exist, instead of the generic 'pass --base' message", () => {
    writeFileSync(join(repo, "README.md"), "x\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: repo });

    const result = runCli(["check", "--base", "this-branch-does-not-exist"], repo);

    expect(result.status).toBe(2);
    // The pre-fix bug printed this exact misleading text even though --base
    // WAS passed explicitly - it must be gone now.
    expect(result.stderr).not.toContain("could not determine a base ref");
  });
});
