import { checkScope, safeParseManifest } from "./packages/core/dist/index.js";

const N = Number(process.argv[2]);

const manifest = safeParseManifest(`
version: 1
mode: enforce
scopes:
  - id: migrations
    globs:
      - "db/migrations/*_*_*_*_*_*_*.sql"
`);

const evilPath = "db/migrations/" + "_".repeat(N) + "nomatch.txt";
const t0 = process.hrtime.bigint();
const result = checkScope(manifest, [{ path: evilPath, isSymlink: false, isSubmodule: false }]);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`N=${N} pathlen=${evilPath.length} -> ${ms.toFixed(1)} ms (passed=${result.passed})`);
