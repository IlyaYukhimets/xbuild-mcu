#!/usr/bin/env node
/*
 * Validate package.json after it was edited by four separate scripts (ts2/ts5/ts6/ts8).
 * Webpack does not read these fields, so compile success proves nothing about them.
 *
 * Checks: JSON validity, duplicate sibling keys, command id cross-reference against the
 * TypeScript sources, keybindings, view menus, task schema, and CHANGELOG consistency.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const raw = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "  PASS " : "  FAIL ") + name + (extra ? " -> " + extra : ""));
  if (!cond) fail++;
};

let pkg;
try {
  pkg = JSON.parse(raw);
  ok("package.json parses", true);
} catch (e) {
  ok("package.json parses", false, e.message);
  process.exit(1);
}

/**
 * Detect duplicate keys within the SAME object.
 *
 * A naive "same key at the same indentation" scan reports every homogeneous array as a
 * duplicate: `contributes.commands` repeats "command"/"title" a dozen times,
 * `keybindings` repeats "command"/"key", and the view/title menus repeat
 * "command"/"group". Those are legitimate distinct objects. So the scan tracks a real
 * container stack and only compares keys that share one object.
 */
function findDuplicateKeys(text) {
  const stack = [];
  const dupes = [];
  let i = 0;

  const readString = () => {
    let out = "";
    i++; // opening quote
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") { out += text[i + 1]; i += 2; continue; }
      if (c === '"') { i++; break; }
      out += c;
      i++;
    }
    return out;
  };

  while (i < text.length) {
    const c = text[i];

    if (c === "{") { stack.push({ type: "obj", keys: new Set() }); i++; continue; }
    if (c === "[") { stack.push({ type: "arr" }); i++; continue; }
    if (c === "}" || c === "]") { stack.pop(); i++; continue; }

    if (c === '"') {
      const start = i;
      const value = readString();
      // A string is a key when it is followed by ':' inside the current object.
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      const isKey = text[j] === ":" && stack.length > 0 &&
                    stack[stack.length - 1].type === "obj";
      if (isKey) {
        const top = stack[stack.length - 1];
        if (top.keys.has(value)) {
          const line = text.slice(0, start).split("\n").length;
          dupes.push(`"${value}" at line ${line}`);
        }
        top.keys.add(value);
      }
      continue;
    }

    i++;
  }
  return dupes;
}

const dupes = findDuplicateKeys(raw);
ok("no duplicate keys within an object", dupes.length === 0, dupes.join(", "));

// ---- contributed commands vs handlers in code ----
const cmds = (pkg.contributes?.commands ?? []).map((c) => c.command);
ok("contributes.commands present", cmds.length > 0, cmds.length + " commands");

const srcDir = path.join(ROOT, "src");
const codeIds = new Set();
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith(".ts")) continue;
  const text = fs.readFileSync(path.join(srcDir, file), "utf8");
  for (const m of text.matchAll(/id:\s*"(xmake\.[A-Za-z0-9_.]+)"/g)) codeIds.add(m[1]);
}
const missingInPkg = [...codeIds].filter((id) => !cmds.includes(id));
const missingInCode = cmds.filter((id) => !codeIds.has(id));
ok("every handler id is contributed", missingInPkg.length === 0, missingInPkg.join(", "));
ok("every contributed id has a handler", missingInCode.length === 0, missingInCode.join(", "));

for (const id of ["xmake.setTarget", "xmake.addTarget", "xmake.runTask"]) {
  ok(`contributed: ${id}`, cmds.includes(id));
  ok(`handler: ${id}`, codeIds.has(id));
}

// ---- keybindings (a duplicate keybinding *key* is a real conflict) ----
const kbs = pkg.contributes?.keybindings ?? [];
const kbCmds = kbs.map((k) => k.command);
ok("keybinding for setTarget", kbCmds.includes("xmake.setTarget"), kbCmds.join(", "));
const byKey = new Map();
const conflicted = [];
for (const kb of kbs) {
  const slot = `${kb.key}|${kb.when ?? ""}`;
  if (byKey.has(slot)) conflicted.push(`${kb.key} (${byKey.get(slot)} vs ${kb.command})`);
  byKey.set(slot, kb.command);
}
ok("no two commands bound to the same key+when", conflicted.length === 0, conflicted.join(", "));

// ---- view menus ----
const vt = pkg.contributes?.menus?.["view/title"] ?? [];
ok("view/title menus present", vt.length >= 3, vt.map((m) => m.command).join(","));
ok(
  "view/title when-clauses reference the real view ids",
  vt.every((m) => /view == xmake\.(mainView|actionsView)/.test(m.when ?? "")),
  JSON.stringify(vt.map((m) => `${m.command}:${m.when}`)),
);

// ---- task schema ----
const props = pkg.contributes?.taskDefinitions?.[0]?.properties ?? {};
ok("taskDefinitions.command", !!props.command);
ok("taskDefinitions.mode", !!props.mode);
ok("taskDefinitions.target", !!props.target, Object.keys(props).join(","));

// ---- packaging: resources/targets must NOT be excluded from the .vsix ----
const ignore = fs.readFileSync(path.join(ROOT, ".vscodeignore"), "utf8");
const excludedResources = ignore
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .some((l) => l.startsWith("resources"));
ok("resources/** not excluded from the package", !excludedResources);
ok("test/** excluded from the package", /^test\/\*\*$/m.test(ignore));
ok("src/** excluded from the package", /^src\/\*\*$/m.test(ignore));

// ---- docs consistency ----
const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
ok(`CHANGELOG documents the current version (${pkg.version})`, changelog.includes(pkg.version));

console.log("---");
console.log(fail === 0 ? "PACKAGE.JSON OK" : fail + " check(s) failed");
process.exit(fail === 0 ? 0 : 1);
