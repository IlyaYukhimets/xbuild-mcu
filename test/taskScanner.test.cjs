#!/usr/bin/env node
/*
 * Offline tests for the pure discovery functions. They deliberately avoid the VS
 * Code API, so they run anywhere (no Extension Host, no display) - which is the
 * only real verification available for this part of the extension.
 *
 * Compile first:
 *   npx tsc src/taskScanner.ts --outDir /tmp/tsout --module commonjs --target ES2022 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck
 * Then:
 *   REPO=$PWD TSOUT=/tmp/tsout node test/taskScanner.test.cjs
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Default to the repo-local output dir so `npm run test:unit` needs no env vars.
const REPO = process.env.REPO || path.resolve(__dirname, "..");
const OUT =
  process.env.TSOUT || path.resolve(__dirname, "..", ".test-out");
const { extractTaskNames, scanCustomTasks } = require(path.join(OUT, "taskScanner.js"));

let pass = 0;
const check = (name, fn) => {
  try { fn(); console.log("  PASS " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + " -> " + e.message); process.exitCode = 1; }
};

console.log("--- extractTaskNames ---");

check("finds a task id and its description (no declared options)", () => {
  const src = 'task("flash")\n    set_menu { usage = "xmake flash", description = "Flash firmware" }\n    on_run(function () end)\n';
  const got = extractTaskNames(src);
  assert.deepStrictEqual(got, [
    { name: "flash", description: "Flash firmware", acceptsTarget: false },
  ]);
});

check("does NOT borrow the next task's description (no set_menu)", () => {
  const src = [
    'task("first")',
    "    on_run(function () end)",
    'task("second")',
    '    set_menu { description = "second description" }',
    "    on_run(function () end)",
  ].join("\n");
  const got = extractTaskNames(src);
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].name, "first");
  assert.strictEqual(got[0].description, "", "first task has no set_menu -> empty description");
  assert.strictEqual(got[1].description, "second description");
  assert.strictEqual(got[1].acceptsTarget, false, "no options -> no target support");
});

check("ignores task_end() and indented task()", () => {
  const src = 'task("real")\n    on_run(function () end)\n    task_end()\n' +
              "    -- nested task( in a comment is still matched only at line start\n";
  const got = extractTaskNames(src);
  assert.deepStrictEqual(got.map((t) => t.name), ["real"]);
});

console.log("--- acceptsTarget (the flag that decides --target=...) ---");

check("detects a kv target option (audit/flash shape)", () => {
  const src = [
    'task("audit")',
    "    set_menu {",
    '        usage = "xmake audit [options]",',
    '        description = "Audit the built image",',
    "        options = {",
    '            {nil, "elf", "kv", nil, "audit a specific ELF"},',
    '            {nil, "target", "kv", nil, "target whose artifact to audit"},',
    "        }",
    "    }",
    "    on_run(function () end)",
  ].join("\n");
  const got = extractTaskNames(src);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].acceptsTarget, true, "kv target option must be recognised");
});

check("detects a string-typed target option", () => {
  const src = 'task("x")\n    set_menu { options = { {nil, "target", "string", nil, "t"} } }\n';
  assert.strictEqual(extractTaskNames(src)[0].acceptsTarget, true);
});

check("a BOOLEAN target flag does NOT count (would not take --target=<name>)", () => {
  // The trap documented in flash.lua: a bare `target = true` in set_menu is ignored by
  // xmake, so passing --target= would be rejected as an unknown option.
  const src = 'task("y")\n    set_menu { description = "d", target = true }\n';
  assert.strictEqual(extractTaskNames(src)[0].acceptsTarget, false);
});

check("another task's target option does not leak across (scope)", () => {
  const src = [
    'task("first")',
    "    set_menu { description = 'no options here' }",
    "    on_run(function () end)",
    'task("second")',
    '    set_menu { options = { {nil, "target", "kv", nil, "t"} } }',
  ].join("\n");
  const got = extractTaskNames(src);
  assert.strictEqual(got[0].acceptsTarget, false, "first has no options");
  assert.strictEqual(got[1].acceptsTarget, true, "second declares target");
});

check("parses the real shipped audit.lua: target-aware, described", () => {
  const p = path.join(REPO, "resources", "tasks", "audit.lua");
  const got = extractTaskNames(fs.readFileSync(p, "utf8"));
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].name, "audit");
  assert.ok(got[0].description.length > 0, "audit.lua declares a description");
  assert.strictEqual(got[0].acceptsTarget, true, "audit.lua declares --target");
});

check("parses the real shipped flash.lua: target-aware", () => {
  const p = path.join(REPO, "resources", "tasks", "flash.lua");
  const got = extractTaskNames(fs.readFileSync(p, "utf8"));
  assert.strictEqual(got[0].name, "flash");
  assert.strictEqual(got[0].acceptsTarget, true, "flash.lua declares --target");
});

console.log("--- scanCustomTasks ---");

const ws = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
fs.mkdirSync(path.join(ws, ".lua", "tasks"), { recursive: true });

check("empty workspace -> no tasks", () => {
  assert.deepStrictEqual(scanCustomTasks(ws), []);
});

check("shipped tasks and xmake.lua's debug/release are filtered out", () => {
  const dir = path.join(ws, ".lua", "tasks");
  fs.writeFileSync(path.join(dir, "flash.lua"), 'task("flash")\n    set_menu { description = "shipped" }\n');
  fs.writeFileSync(path.join(dir, "docs.lua"), 'task("docs")\n');
  fs.writeFileSync(path.join(dir, "cubemx.lua"), 'task("cubemx")\n');
  fs.writeFileSync(path.join(dir, "template.lua"), 'task("template")\n');
  fs.writeFileSync(path.join(dir, "audit.lua"),
    'task("audit")\n    set_menu { description = "Audit the built image", options = { {nil, "target", "kv", nil, "t"} } }\n');
  fs.writeFileSync(path.join(ws, "xmake.lua"), 'task("debug")\ntask("release")\n');

  const got = scanCustomTasks(ws);
  assert.deepStrictEqual(got.map((t) => t.name), ["audit"], "only the project task remains");
  assert.strictEqual(got[0].description, "Audit the built image");
  assert.strictEqual(got[0].file, ".lua/tasks/audit.lua");
  assert.strictEqual(got[0].acceptsTarget, true, "acceptsTarget survives the scan");
});

check("unsafe task names are filtered out before they reach a command line", () => {
  fs.writeFileSync(path.join(ws, ".lua", "tasks", "weird.lua"),
    'task("bad name; rm -rf /")\ntask("ok_name")\n');
  const names = scanCustomTasks(ws).map((t) => t.name);
  assert.ok(!names.includes("bad name; rm -rf /"), "shell metacharacters must be rejected");
  assert.ok(names.includes("ok_name"), "safe names still pass");
});

check("several project tasks are sorted, and a duplicate is collapsed", () => {
  fs.writeFileSync(path.join(ws, ".lua", "tasks", "zz.lua"), 'task("zeta")\ntask("alpha")\n');
  fs.writeFileSync(path.join(ws, ".lua", "tasks", "aa.lua"), 'task("alpha")\n'); // duplicate
  const names = scanCustomTasks(ws).map((t) => t.name);
  assert.deepStrictEqual(names, ["alpha", "audit", "ok_name", "zeta"]);
  assert.strictEqual(names.filter((n) => n === "alpha").length, 1, "deduplicated");
});

check("reserved xmake task names are never surfaced", () => {
  fs.writeFileSync(path.join(ws, ".lua", "tasks", "reserved.lua"), 'task("build")\ntask("run")\n');
  const names = scanCustomTasks(ws).map((t) => t.name);
  assert.ok(!names.includes("build") && !names.includes("run"), "reserved names stay hidden");
});

fs.rmSync(ws, { recursive: true, force: true });

console.log("--- result: " + pass + " passed ---");
