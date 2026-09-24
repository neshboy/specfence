import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // tsup's isolated dts-rollup program doesn't get along with `composite: true`
  // (needed at the package level for the root `tsc -b` project-reference
  // typecheck) - turn it off just for this one-off declaration build.
  dts: { compilerOptions: { composite: false } },
  sourcemap: true,
  clean: true,
  target: "node20"
});
