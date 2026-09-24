import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // CommonJS, not ESM: GitHub Actions runs `node dist/index.js` directly,
  // and an ESM file needs either a .mjs extension or a "type": "module"
  // package.json right next to it to parse correctly - CJS avoids that
  // ambiguity entirely regardless of how dist/ ends up laid out.
  format: ["cjs"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  // .cjs (not .js) so Node always treats this as CommonJS at run time,
  // regardless of this package's own "type": "module" (kept for consistent
  // NodeNext module resolution across the monorepo's TypeScript sources).
  outExtension: () => ({ js: ".cjs" }),
  // GitHub Actions can't run `npm install` at use-time, so the bundle must
  // be fully self-contained - inline every dependency, no exceptions.
  noExternal: [/.*/],
});
