#!/usr/bin/env node
/*
 * Offline tests for chooseTarget() - the target-precedence decision behind both the
 * status-bar commands and the VS Code Task API.
 *
 * Why a separate file: the logic used to live in taskProvider.ts, which imports "vscode"
 * and therefore cannot be required outside an Extension Host. Moving it into the
 * vscode-free projectConfig.ts is what makes it testable at all, so this suite is the
 * actual evidence for the fix - not a compile pass.
 *
 * Compiled transitively: taskScanner.ts imports projectConfig, so `npm run test:unit`
 * emits projectConfig.js into .test-out.
 */
const path = require("node:path");
const OUT = process.env.TSOUT || path.resolve(__dirname, "..", ".test-out");

let fail = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "  PASS " : "  FAIL ") + name + (extra ? " -> " + extra : ""));
  if (!cond) fail++;
};

const { chooseTarget, DEFAULT_TARGET_STEM } = require(path.join(OUT, "projectConfig.js"));

console.log("--- chooseTarget precedence ---");

// 1. An explicit target wins unconditionally: it is the contract of a tasks.json entry,
//    and v2.0.1 shipped addresses like {command:"build", mode:"release"}.
ok(
  "explicit wins even when it is not on disk",
  chooseTarget(["alpha", "beta"], "gamma", "alpha") === "gamma",
  chooseTarget(["alpha", "beta"], "gamma", "alpha"),
);

// 2. The active target beats stems[0] when it exists - the bug being fixed.
ok(
  "active target beats the alphabetically-first stem",
  chooseTarget(["alpha", "beta"], undefined, "beta") === "beta",
  chooseTarget(["alpha", "beta"], undefined, "beta"),
);

// 3. A stale active target (its file was deleted) must not be handed to xmake.
ok(
  "stale active target falls back to a stem that exists",
  chooseTarget(["alpha", "beta"], undefined, "zeta") === "alpha",
  chooseTarget(["alpha", "beta"], undefined, "zeta"),
);

// 4. Legacy single-image project: no target files at all. The active target legitimately
//    names the one target the template builds, so it must be honoured rather than
//    replaced by the default stem.
ok(
  "empty stems + active keeps the active target",
  chooseTarget([], undefined, "myboard") === "myboard",
  chooseTarget([], undefined, "myboard"),
);

// 5. Nothing selected, nothing on disk -> the id the template builds.
ok(
  "empty stems + no active -> DEFAULT_TARGET_STEM",
  chooseTarget([], undefined, undefined) === DEFAULT_TARGET_STEM,
  chooseTarget([], undefined, undefined),
);

// 6. Nothing selected, files present -> deterministic first stem (readTargetFiles sorts).
ok(
  "stems + no active -> first stem",
  chooseTarget(["alpha", "beta"], undefined, undefined) === "alpha",
  chooseTarget(["alpha", "beta"], undefined, undefined),
);

// 7. An empty-string active value must be treated as absent, not returned: it would
//    otherwise reach xmake as an empty target name. Same class of bug as the Lua-side
//    "empty string is truthy" issues fixed in the template.
ok(
  'empty-string active is ignored ("" is not a target)',
  chooseTarget(["alpha"], undefined, "") === "alpha",
  chooseTarget(["alpha"], undefined, ""),
);

console.log("---");
console.log(fail === 0 ? "TARGET CHOICE OK" : `${fail} check(s) failed`);
process.exit(fail === 0 ? 0 : 1);
