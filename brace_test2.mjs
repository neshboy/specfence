import { minimatch } from "minimatch";

for (const k of [5, 10, 15, 16, 17, 20]) {
  const pat = "{a,b}".repeat(k);
  try {
    const t0 = process.hrtime.bigint();
    const r = minimatch("a", pat, { dot: true, nocase: false });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`k=${k} patlen=${pat.length} -> match=${r} (${ms.toFixed(1)}ms)`);
  } catch (e) {
    console.log(`k=${k} patlen=${pat.length} -> THROW: ${e.message}`);
  }
}
