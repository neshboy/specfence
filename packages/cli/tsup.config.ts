import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // CommonJS, not ESM: @specfence/core is inlined (see noExternal below),
  // which drags core's own CJS dependency (`yaml`) into the bundle too.
  // esbuild's ESM output can't safely rewrite that dependency's internal
  // `require("process")` calls (no real `require` exists at runtime in
  // ESM), and throws "Dynamic require of ... is not supported" - CJS
  // output has a real `require`, so the exact same bundle just works.
  format: ["cjs"],
  platform: "node",
  target: "node20",
  // .cjs (not .js) so Node always treats this as CommonJS at run time,
  // regardless of this package's own "type": "module" (kept for consistent
  // NodeNext module resolution across the monorepo's TypeScript sources).
  outExtension: () => ({ js: ".cjs" }),
  // tsup's isolated dts-rollup program doesn't get along with `composite: true`
  // (needed at the package level for the root `tsc -b` project-reference
  // typecheck) - turn it off just for this one-off declaration build.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  // src/index.ts already starts with its own `#!/usr/bin/env node` shebang,
  // which tsup preserves as-is - no banner needed (a duplicate would land
  // on line 2, which Node's loader does NOT strip).
  // @specfence/core is a private, unpublished workspace package (see
  // packages/core/package.json). It exists purely to share code between
  // this CLI and the GitHub Action, and is never itself published to npm,
  // so it MUST be inlined into this bundle rather than left as an external
  // "dependency" that a real `npm install specfence` could never resolve.
  noExternal: ["@specfence/core"],
});
