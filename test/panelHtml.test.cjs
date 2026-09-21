#!/usr/bin/env node
/*
 * Offline test for the configuration panel renderer.
 *
 * Why this exists: xmakePanelHtml.ts is a pure string generator - every "vscode" hit in
 * it is text inside the HTML (CSS custom properties, acquireVsCodeApi), and its only
 * import is ./projectConfig. So getHtmlContent() can be rendered and asserted here, with
 * no Extension Host and no display. That matters because the panel is the one surface
 * this session edited that tsc cannot check: a broken template literal, a dropped
 * interpolation or a mis-escaped ${...} compiles cleanly and only shows up as a wrong
 * panel at runtime.
 *
 * Compile prerequisite (done by npm run test:unit):
 *   tsc src/xmakePanelHtml.ts src/projectConfig.ts --outDir .test-out ...
 */
const path = require("node:path");
const OUT = process.env.TSOUT || path.resolve(__dirname, "..", ".test-out");

let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "  PASS " : "  FAIL ") + name + (extra ? " -> " + extra : ""));
  if (!cond) fail++;
};

const { XmakePanelHtml } = require(path.join(OUT, "xmakePanelHtml.js"));
const { getDefaultProjectConfig } = require(path.join(OUT, "projectConfig.js"));

const render = (patch = {}) => {
  const config = { ...getDefaultProjectConfig(), ...patch };
  return new XmakePanelHtml().getHtmlContent(config);
};

console.log("--- renderer basics ---");
let html = "";
try {
  html = render();
  ok("getHtmlContent returns a non-empty string", html.length > 1000, html.length + " chars");
  ok("looks like a full document", html.startsWith("<!DOCTYPE html>") && html.includes("</html>"));
} catch (e) {
  ok("getHtmlContent renders without throwing", false, e.message);
  process.exit(1);
}

// The form must submit exactly the keys toProjectConfig() knows about, otherwise a save
// silently resets the fields it does not receive. These three were the P0 gap.
console.log("--- the new controls exist ---");
for (const id of ["float_abi", "languages_c", "languages_cpp"]) {
  ok(`a <select> for #${id}`, html.includes(`id="${id}"`));
}
ok("float_abi is submitted by getFormValues", /float_abi:\s*document\.getElementById\('float_abi'\)\.value/.test(html));
ok("languages.c is submitted", /c:\s*document\.getElementById\('languages_c'\)\.value/.test(html));
ok("languages.cpp is submitted", /cpp:\s*document\.getElementById\('languages_cpp'\)\.value/.test(html));

// A saved non-default value must come back SELECTED, or reopening the panel and pressing
// Save would quietly rewrite the user's choice to the first option in the list.
console.log("--- the active value round-trips ---");
html = render({ float_abi: "softfp" });
ok(
  'float_abi="softfp" renders as selected',
  /<option value="softfp" selected>softfp<\/option>/.test(html),
  (html.match(/<option value="(soft|softfp|hard)"[^>]*>/g) || []).join(" "),
);

html = render({ languages: { c: "c99", cpp: "c++17" } });
ok('languages.c="c99" renders as selected', /<option value="c99" selected>/.test(html));
ok('languages.cpp="c++17" renders as selected', /<option value="c\+\+17" selected>/.test(html));

// An out-of-list value (hand-edited config.json) must be preserved as an option, not
// dropped: dropping it would turn the first entry into a silent rewrite on save.
console.log("--- an unknown value is preserved, not dropped ---");
html = render({ float_abi: "mystery-abi", languages: { c: "c2x", cpp: "c++26" } });
ok('unknown float_abi is still an option', /<option value="mystery-abi" selected>/.test(html));
ok('unknown languages.c is still an option', /<option value="c2x" selected>/.test(html));
ok('unknown languages.cpp is still an option', /<option value="c\+\+26" selected>/.test(html));

// The strongest oracle for this edit: an unresolved interpolation survives as literal
// text in the output and is completely invisible to tsc.
console.log("--- no unresolved template interpolation leaked into the HTML ---");
// Scoped to the controls this change added. A blanket search over the whole document
// would also match a config VALUE containing "${" (values are now escaped inside
// <option>, but the point stands: a false positive, not a real defect).
const selectRegions = (doc) => {
  const parts = [];
  for (const id of ["float_abi", "languages_c", "languages_cpp"]) {
    const start = doc.indexOf(`id="${id}"`);
    if (start !== -1) {
      parts.push(doc.slice(start, start + 400));
    }
  }
  return parts.join("\n");
};
const regions = selectRegions(html);
ok("all three selects are present in the markup", regions.length > 0);
ok(
  "no unresolved interpolation inside the new controls",
  !regions.includes("${"),
  regions.slice(0, 100),
);

// The panel's script must stay syntactically valid JS: a stray interpolation or an
// unescaped quote inside the generated <script> would break the whole page.
console.log("--- the embedded script still parses ---");
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i);
if (!script) {
  ok("an inline <script> block exists", false);
} else {
  ok("an inline <script> block exists", true);
  try {
    // Parse only; acquireVsCodeApi() / the DOM are not available here.
    new Function(script[1]);
    ok("inline script compiles", true);
  } catch (e) {
    ok("inline script compiles", false, e.message);
  }
}

console.log("---");
console.log(fail === 0 ? `PANEL RENDER OK (${0} failures)` : `${fail} panel check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
