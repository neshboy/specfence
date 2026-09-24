export interface GeneratedManifest {
  scopeId: string;
  description: string;
  globs: string[];
  /** True when there were no changed files to bucket - a permissive starter manifest, not a real proposal. */
  bootstrap: boolean;
}

/**
 * The MVP "branch-diff" generator: bucket changed paths by their top-level
 * path segment into one scope's glob list. Deliberately dumb - it's meant
 * to be reviewed and edited by a human, not to be a final answer.
 */
export function generateFromPaths(paths: string[]): GeneratedManifest {
  if (paths.length === 0) {
    return {
      scopeId: "initial",
      description:
        "No changes detected yet on this branch. This starter manifest allows everything - narrow it down as your project grows.",
      globs: ["**"],
      bootstrap: true,
    };
  }

  const globs = new Set<string>();
  for (const path of paths) {
    const slash = path.indexOf("/");
    globs.add(slash === -1 ? path : `${path.slice(0, slash)}/**`);
  }

  return {
    scopeId: "initial",
    description: "Auto-generated from files changed on the current branch. Review and edit before committing.",
    globs: [...globs].sort(),
    bootstrap: false,
  };
}

const DEFAULT_IGNORE = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/node_modules/**",
  "**/*.min.js",
  "**/*.map",
];

export function renderManifestYaml(generated: GeneratedManifest, includeDefaultIgnore: boolean): string {
  const lines: string[] = [
    "# SpecFence scope manifest.",
    "# This file is read from the BASE branch on every PR, never from the PR's own",
    "# head - so widening scope always requires a separate, reviewed change here.",
    "# Docs: https://github.com/neshboy/specfence",
    "version: 1",
    "",
  ];

  if (includeDefaultIgnore) {
    lines.push("ignore:");
    for (const glob of DEFAULT_IGNORE) lines.push(`  - "${glob}"`);
    lines.push("");
  }

  lines.push("scopes:");
  lines.push(`  - id: ${generated.scopeId}`);
  lines.push(`    description: "${generated.description.replace(/"/g, '\\"')}"`);
  lines.push("    globs:");
  for (const glob of generated.globs) lines.push(`      - "${glob}"`);
  lines.push("");

  return lines.join("\n");
}
