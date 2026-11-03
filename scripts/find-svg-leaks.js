/* Find esc(<identifier>(...)) call sites — places where a function's
   return value gets escaped. If that function returns markup (icons,
   <b>, <span>...), the page shows raw markup as text. */
const fs = require("fs");
const path = require("path");
const ROOT = "/home/z/my-project/hub-work-new/ui csdu";
const FILES = [
  "apps/football/public/index.html",
  "apps/table-tennis/public/index.html",
  "apps/football/public/live-match.js",
  "public/ui.js",
  "public/index.html",
];

for (const rel of FILES) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const lines = src.split("\n");
  console.log("\n=== " + rel);

  // collect candidate call sites: esc( fn( ... )) possibly with prefix expr
  const hits = new Map(); // fnName -> [line numbers]
  lines.forEach((ln, i) => {
    // match esc( ... identifier( ... ) — crude but effective on template code
    const re = /esc\(\s*([A-Za-z0-9_$]+)\s*\(/g;
    let m;
    while ((m = re.exec(ln))) {
      const fn = m[1];
      if (fn === "String") continue;
      if (!hits.has(fn)) hits.set(fn, []);
      hits.get(fn).push(i + 1);
    }
    // also: esc(`...${fn(...)}...) — functions interpolated inside esc args
    const re2 = /esc\(\s*`[^`]*\$\{\s*([A-Za-z0-9_$]+)\s*\(/g;
    while ((m = re2.exec(ln))) {
      const fn = m[1];
      if (!hits.has(fn)) hits.set(fn, []);
      hits.get(fn).push(i + 1);
    }
  });

  // for each referenced fn, check if its body returns markup
  const fnRe = /function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{/g;
  const defs = new Map();
  let m;
  while ((m = fnRe.exec(src))) {
    const start = m.index;
    let next = src.indexOf("\nfunction ", start + 10);
    if (next === -1) next = src.length;
    defs.set(m[1], src.slice(start, next));
  }

  for (const [fn, at] of hits) {
    const body = defs.get(fn);
    if (!body) continue; // defined elsewhere (e.g. logic.js engine — plain data)
    // strip comments before testing: a comment that *mentions* <svg is
    // not markup (v2.3.1's fix comments tripped the naive test)
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const markup = /ic\(|HUB_ICONS|<[a-z][^>]*>/.test(code);
    if (markup) {
      console.log(`  !! esc(${fn}(...)) — fn body contains markup @lines ${at.join(",")}`);
      for (const n of at) {
        console.log("     " + n + ": " + lines[n - 1].trim().slice(0, 170));
      }
    }
  }
}
console.log("\ndone");
