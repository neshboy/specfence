#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { checkScope, ManifestError, safeParseManifest, type ChangeEntry, type ScopeManifest } from "@specfence/core";
import { assertRefExists, getChangedEntries, getUntrackedFiles, GitError, readFileAtRef, resolveDefaultBase } from "./git.js";
import { generateFromPaths, renderManifestYaml } from "./generate.js";
import { formatGithubAnnotations, formatHuman, formatJson } from "./output.js";

// Fail closed rather than validate a possibly-truncated changed-file list -
// mirrors the Action's own cap on the GitHub PR-files API.
const MAX_CHANGED_FILES = 5000;

const program = new Command();
program
  .name("specfence")
  .description("Zero-infra scope guard for AI-agent (and human) pull requests.")
  .version("0.1.0");

function resolveBase(cwd: string, flagBase: string | undefined): string | undefined {
  const base = flagBase ?? process.env.SPECFENCE_BASE ?? resolveDefaultBase(cwd);
  if (!base) return undefined;
  try {
    assertRefExists(cwd, base);
  } catch {
    return undefined;
  }
  return base;
}

program
  .command("check")
  .description("Diff HEAD against a base ref and fail if any changed file falls outside .specfence/scope.yaml")
  .option("--base <ref>", "base ref to compare against (default: origin/HEAD, or $SPECFENCE_BASE)")
  .option("--head <ref>", "head ref to compare", "HEAD")
  .option("--manifest-path <path>", "path to the scope manifest, relative to repo root", ".specfence/scope.yaml")
  .option("--json", "emit machine-readable JSON instead of human-readable output", false)
  .option("--github", "emit GitHub Actions ::error:: annotations instead of human-readable output", false)
  .action((opts: { base?: string; head: string; manifestPath: string; json: boolean; github: boolean }) => {
    const cwd = process.cwd();
    const base = resolveBase(cwd, opts.base);
    if (!base) {
      console.error(
        'error: could not determine a base ref to compare against.\nPass --base explicitly (e.g. --base origin/main), or set SPECFENCE_BASE.'
      );
      process.exitCode = 2;
      return;
    }

    const manifestText = readFileAtRef(cwd, base, opts.manifestPath);
    if (manifestText === undefined) {
      const message = `No ${opts.manifestPath} found on ${base} - SpecFence isn't enforcing anything yet. Run "npx specfence init" to scaffold one.`;
      console.log(opts.json ? JSON.stringify({ adopted: false, message }) : message);
      process.exitCode = 0;
      return;
    }

    let manifest: ScopeManifest;
    try {
      manifest = safeParseManifest(manifestText, { source: `${opts.manifestPath} @ ${base}` });
    } catch (err) {
      if (err instanceof ManifestError) {
        console.error(`error: ${err.message}`);
        process.exitCode = 2;
        return;
      }
      throw err;
    }

    let changes: ChangeEntry[];
    try {
      changes = getChangedEntries(cwd, base, opts.head);
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      process.exitCode = 2;
      return;
    }

    if (changes.length > MAX_CHANGED_FILES) {
      console.error(
        `error: ${changes.length} changed files exceeds SpecFence's safety cap of ${MAX_CHANGED_FILES} - failing closed rather than risk validating a truncated list.`
      );
      process.exitCode = 2;
      return;
    }

    const result = checkScope(manifest, changes);
    const meta = { base, manifestPath: opts.manifestPath, changedFiles: changes.length };

    if (opts.json) console.log(formatJson(result, meta));
    else if (opts.github) console.log(formatGithubAnnotations(result));
    else console.log(formatHuman(result, meta));

    process.exitCode = result.passed ? 0 : 1;
  });

program
  .command("init")
  .description("Scaffold .specfence/scope.yaml from files changed on the current branch")
  .option("--base <ref>", "base ref to diff against (default: origin/HEAD, or $SPECFENCE_BASE)")
  .option("--out <path>", "where to write the manifest", ".specfence/scope.yaml")
  .option("--force", "overwrite an existing manifest", false)
  .option("--no-default-ignore", "skip seeding the recommended ignore list for lockfiles/build output")
  .option("--dry-run", "print the generated manifest instead of writing it", false)
  .action((opts: { base?: string; out: string; force: boolean; defaultIgnore: boolean; dryRun: boolean }) => {
    const cwd = process.cwd();
    const outPath = join(cwd, opts.out);

    if (existsSync(outPath) && !opts.force && !opts.dryRun) {
      console.error(`error: ${opts.out} already exists. Pass --force to overwrite, or --dry-run to preview.`);
      process.exitCode = 2;
      return;
    }

    const base = resolveBase(cwd, opts.base);
    let changedPaths: string[] = [];
    if (base) {
      try {
        changedPaths = getChangedEntries(cwd, base).map((c) => c.path);
      } catch {
        // init must always succeed - fall back to untracked-only rather than error.
      }
    }

    try {
      changedPaths = [...new Set([...changedPaths, ...getUntrackedFiles(cwd)])];
    } catch (err) {
      if (err instanceof GitError) {
        console.error(`error: ${err.message}`);
        process.exitCode = 2;
        return;
      }
      throw err;
    }

    const generated = generateFromPaths(changedPaths);
    const yaml = renderManifestYaml(generated, opts.defaultIgnore !== false);

    if (opts.dryRun) {
      console.log(yaml);
      process.exitCode = 0;
      return;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, yaml, "utf8");
    console.log(
      `Wrote ${opts.out}${generated.bootstrap ? " (no changes detected yet, so it allows everything for now - narrow it down as you go)" : ""}.`
    );
    process.exitCode = 0;
  });

program.parse(process.argv);
