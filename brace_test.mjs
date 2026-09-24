import { minimatch } from "minimatch";

function nested(depth) {
  let s = "a";
  for (let i = 0; i < depth; i++) s = `{a,${s}}`;
  return s;
}

for (const depth of [5, 10, 14, 15, 16, 20]) {
  const pat = nested(depth);
  try {
    const r = minimatch("a", pat, { dot: true, nocase: false });
    console.log(`depth=${depth} patlen=${pat.length} -> match=${r}`);
  } catch (e) {
    console.log(`depth=${depth} patlen=${pat.length} -> THROW: ${e.message}`);
  }
}
