import { execFileSync } from "node:child_process";
import type { ChangeEntry } from "@specfence/core";
import { DecodeError, safeDecodeUtf8 } from "@specfence/core";

export class GitError extends Error {}

function git(cwd: string, args: string[]): string {
  let buffer: Buffer;
  try {
    // execFileSync (argv array, no shell) - never string-concatenated into a
    // shell command, so ref names / paths can never break out into shell
    // injection regardless of what characters they contain. No `encoding`
    // option: we decode strictly ourselves below (see safeDecodeUtf8) -
    // Node's own "utf8" encoding here would LOSSILY replace invalid bytes
    // with U+FFFD, which previously let a corrupted base-ref manifest byte
    // silently defeat a `deny` rule with no diagnostic at all. `stdio` is
    // explicit so a failing git command's stderr is only ever captured into
    // the thrown error, never also relayed live to our own real stderr
    // (which otherwise leaks a raw "fatal: ..." line even on the common,
    // entirely-expected "no manifest on this ref yet" path).
    buffer = execFileSync("git", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 64,
    }) as Buffer;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer | string; message: string };
    if (e.code === "ENOENT") {
      throw new GitError("git was not found on PATH - the specfence CLI shells out to your local git installation.");
    }
    const stderr = e.stderr ? Buffer.from(e.stderr).toString("utf8").trim() : e.message;
    throw new GitError(stderr);
  }
  try {
    return safeDecodeUtf8(buffer, "git output");
  } catch (err) {
    if (err instanceof DecodeError) {
      throw new GitError(
        `git produced output that is not valid UTF-8 - refusing to proceed rather than risk silently corrupting a path or the manifest. (${err.message})`
      );
    }
    throw err;
  }
}

/** The repo's configured default branch, if `origin/HEAD` is set (e.g. after a normal clone). */
export function resolveDefaultBase(cwd: string): string | undefined {
  try {
    const ref = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim();
    return ref || undefined;
  } catch {
    return undefined;
  }
}

export function assertRefExists(cwd: string, ref: string): void {
  git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
}

/** Reads a file's content at a specific ref. Returns undefined if the path doesn't exist there (not an error). */
export function readFileAtRef(cwd: string, ref: string, path: string): string | undefined {
  try {
    return git(cwd, ["show", `${ref}:${path}`]);
  } catch (err) {
    const message = (err as Error).message;
    if (/does not exist in|exists on disk, but not in|fatal: path .* does not exist/.test(message)) {
      return undefined;
    }
    throw err;
  }
}

interface RawDiffRecord {
  status: string;
  oldMode: string;
  newMode: string;
  path: string;
  oldPath?: string;
}

/**
 * Parses `git diff --raw -M -z` output. Using --raw (not --name-status)
 * gets us the old/new file mode bits, which is how symlinks (120000) and
 * submodule gitlinks (160000) are detected - and -z NUL-terminates every
 * field so filenames containing tabs/newlines can't corrupt parsing.
 */
function parseRawDiff(output: string): RawDiffRecord[] {
  const tokens = output.split("\u0000").filter((t) => t.length > 0);
  const entries: RawDiffRecord[] = [];
  let i = 0;
  while (i < tokens.length) {
    const header = tokens[i] ?? "";
    if (!header.startsWith(":")) {
      i += 1;
      continue;
    }
    const parts = header.slice(1).split(" ");
    const oldMode = parts[0] ?? "";
    const newMode = parts[1] ?? "";
    const statusRaw = parts[4] ?? "";
    const status = statusRaw.slice(0, 1);
    i += 1;
    if (status === "R" || status === "C") {
      const oldPath = tokens[i] ?? "";
      const newPath = tokens[i + 1] ?? "";
      i += 2;
      entries.push({ status, oldMode, newMode, path: newPath, oldPath });
    } else {
      const path = tokens[i] ?? "";
      i += 1;
      entries.push({ status, oldMode, newMode, path });
    }
  }
  return entries;
}

function toChangeEntries(records: RawDiffRecord[]): ChangeEntry[] {
  return records.map((r) => {
    // A deletion's newMode is always 000000 (nothing there anymore), so
    // whether the deleted path WAS a symlink/submodule is in oldMode.
    const effectiveMode = r.status === "D" ? r.oldMode : r.newMode;
    return {
      path: r.path,
      oldPath: r.oldPath,
      isSymlink: effectiveMode === "120000",
      isSubmodule: effectiveMode === "160000",
    };
  });
}

/** Copy detection (-C) is deliberately not enabled - see docs/security.md. */
export function getChangedEntries(cwd: string, base: string, head = "HEAD"): ChangeEntry[] {
  const output = git(cwd, ["diff", "--raw", "-M", "-z", "--no-color", `${base}...${head}`]);
  return toChangeEntries(parseRawDiff(output));
}

export function getUntrackedFiles(cwd: string): string[] {
  const output = git(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  return output
    .split("\u0000")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
}
