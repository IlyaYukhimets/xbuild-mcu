#!/bin/bash
# Fixture matrix for resources/xmake-template.lua.
# Fixes over the first revision: per-call log files (rc() used to overwrite a single
# log so ckg checks read the wrong output), literal-safe grep (-F where no
# alternation is needed), and self-contained fixtures (no dependency on /tmp/probe).
set -u

# Resolve paths from this script's location so the matrix runs from anywhere.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
TPL="$REPO/resources/xmake-template.lua"
XM="${XM:-xmake}"
XM_NAME="${XM_NAME:-2.9.9}"
BASE="/tmp/matrix_${XM_NAME}"
# NOTE: deliberately no PATH tweak here. XM is an absolute path, and prepending
# ~/.local/bin would let a bare `xmake` inside a template task resolve to 3.1.x
# while the run is labelled 2.9.x.

rm -rf "$BASE"; mkdir -p "$BASE"
PASS=0; FAIL=0

ok()   { echo "  PASS $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $1 (want [$2] got [$3])"; FAIL=$((FAIL+1)); }
ck()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }
ckf()  { if [ -f "$2" ]; then ok "$1"; else bad "$1" "file" "missing $2"; fi; }
cknf() { if [ ! -f "$2" ]; then ok "$1"; else bad "$1" "no file" "unexpected $2"; fi; }
ckg()  { if grep -Fq -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "pattern[$2]" "not in $3"; fi; }
ckge() { if grep -Eq -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "regex[$2]" "not in $3"; fi; }
ckz()  { if [ ! -s "$2" ]; then ok "$1"; else bad "$1" "empty" "$(cat "$2")"; fi; }

# rcn <tag> [xmake args...] -> runs xmake, captures to $BASE/<tag>.log, echoes rc
rcn() { local tag="$1"; shift; "$XM" "$@" >"$BASE/$tag.log" 2>&1; echo $?; }

newproj() {
  mkdir -p "$1/.lua/targets"
  cp "$TPL" "$1/xmake.lua"
  cat > "$1/main.c" <<'EOF'
#include <stdint.h>
extern uint32_t _estack;
void Reset_Handler(void);
__attribute__((section(".isr_vector"), used))
void (*const g_vectors[])(void) = { (void (*)(void))&_estack, Reset_Handler };
void Reset_Handler(void) { while (1) {} }
EOF
  cat > "$1/probe.ld" <<'EOF'
ENTRY(Reset_Handler)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 1024K
         RAM   (xrw): ORIGIN = 0x20000000, LENGTH = 256K }
_estack = ORIGIN(RAM) + LENGTH(RAM);
SECTIONS {
    .isr_vector : { KEEP(*(.isr_vector)) } >FLASH
    .text : { *(.text*) *(.rodata*) } >FLASH
    .data : { *(.data*) } >RAM AT> FLASH
    .bss  : { *(.bss*) *(COMMON) } >RAM
    _Min_Stack_Size = 0x400;
    _Min_Heap_Size  = 0;
}
EOF
}

CFG_COMMON='    "mcu_series": "STM32F412Rx",
    "mcu_core": "cortex-m4",
    "mcu_device": "STM32F412RG",
    "ld_script": "probe.ld",
    "svd_file": "STM32F412.svd",
    "jlink_path": "/opt/SEGGER/JLink/JLinkExe",
    "arm_gcc_path": "/usr",
    "optimization": { "debug": "debug", "release": "release" },
    "defines": ["PROBE_COMMON"],
    "includedirs": ["."],
    "sources": ["main.c"]'

echo "=============================================="
echo "=== xmake $XM_NAME : fixture matrix ==="
echo "=============================================="
"$XM" --version 2>&1 | head -1

echo "--- syntax: luac5.4 -p ---"
if luac5.4 -p "$TPL" 2>&1; then ok "template lua syntax"; else bad "template lua syntax" "parse ok" "parse error"; fi

# ---------- v1 ----------
echo "--- v1: stem vs name, nameless fallback, postbuild tokens, 2nd-build try/catch ---"
V1="$BASE/v1"; newproj "$V1"
printf '{\n    "name": "Probe",\n%s,\n    "float_abi": "hard",\n    "languages": { "c": "c11", "cpp": "c++17" },\n    "postbuild": "echo POSTBUILD target={target} bin={bin} elf={elf}"\n}\n' "$CFG_COMMON" > "$V1/.lua/config.json"
printf '{ "name": "AlphaBoard", "defines": ["BOARD_ALPHA"] }\n' > "$V1/.lua/targets/alpha.json"
printf '{ "defines": ["NO_NAME_FIELD"] }\n' > "$V1/.lua/targets/nameless.json"
ck "v1 configure" "0" "$(cd "$V1" && rcn v1_cfg f -m debug -y)"
# Addressing a target by its artifact name instead of its file-name stem behaves
# differently across xmake versions: 2.9.x treats it as a silent no-op (rc 0, nothing
# built), 3.1.x reports rc 255. The exit code is therefore informational only; the
# invariant worth asserting - and the one the extension depends on - is that no
# artifact appears. The extension must always address targets by stem.
echo "  INFO v1 build-by-name rc on $XM_NAME: $(cd "$V1" && rcn v1_byname build AlphaBoard)  (2.9.x: 0, 3.1.x: 255)"
ck "v1 build by artifact name produced no artifact (invariant)" "0" "$(cd "$V1" && ls build/cross/arm/debug/*.elf 2>/dev/null | wc -l)"
ck "v1 build alpha by stem" "0" "$(cd "$V1" && rcn v1_alpha build alpha)"
ckf "v1 artifact takes the name field" "$V1/build/cross/arm/debug/AlphaBoard.elf"
ckf "v1 .bin = extension replaced (not .elf.bin)" "$V1/build/cross/arm/debug/AlphaBoard.bin"
cknf "v1 no double-extension .bin" "$V1/build/cross/arm/debug/AlphaBoard.elf.bin"
ckg "v1 postbuild ran" "Postbuild run" "$BASE/v1_alpha.log"
ckg "v1 {target} -> bare artifact name" "target=AlphaBoard bin=" "$BASE/v1_alpha.log"
ckg "v1 {bin} -> real .bin path" "AlphaBoard.bin elf=" "$BASE/v1_alpha.log"
ckg "v1 {elf} -> real .elf path" "AlphaBoard.elf" "$BASE/v1_alpha.log"
ck "v1 rerun build rc" "0" "$(cd "$V1" && rcn v1_rerun build alpha)"
ck "v1 no literal {target} left in output" "0" "$(grep -Fc -- '{target}' "$BASE/v1_rerun.log" 2>/dev/null || true)"
ck "v1 build nameless (2nd build: try/catch + first launch.json)" "0" "$(cd "$V1" && rcn v1_nameless build nameless)"
ckf "v1 nameless falls back to stem" "$V1/build/cross/arm/debug/nameless.elf"

echo "--- v1r: tokens in release ---"
ck "v1 reconfigure release" "0" "$(cd "$V1" && rcn v1_relcfg f -m release -y)"
ck "v1 build alpha release" "0" "$(cd "$V1" && rcn v1_rel build alpha)"
ckf "v1 release artifact path" "$V1/build/cross/arm/release/AlphaBoard.elf"
ckg "v1 release {bin} points at release dir" "release/AlphaBoard.bin" "$BASE/v1_rel.log"

# ---------- v2 ----------
echo "--- v2: launch.json merge, user config kept, JSONC left alone ---"
V2="$BASE/v2"; newproj "$V2"
printf '{\n    "name": "Probe2",\n%s,\n    "float_abi": "hard",\n    "languages": { "c": "c11", "cpp": "c++17" }\n}\n' "$CFG_COMMON" > "$V2/.lua/config.json"
printf '{ "name": "example-one", "defines": ["EXAMPLE_ONE"] }\n' > "$V2/.lua/targets/one.json"
printf '{ "name": "example-two", "defines": ["EXAMPLE_TWO"] }\n' > "$V2/.lua/targets/two.json"
printf '{ "name": "both", "defines": ["EXAMPLE_TWO", "EXAMPLE_ONE"] }\n' > "$V2/.lua/targets/both.json"
# v2-only probe source with define-isolation guards (exercised by the leak check).
cat > "$V2/main.c" <<'CFILE'
#include <stdint.h>
extern uint32_t _estack;
void Reset_Handler(void);

/* Exactly one per-target define must reach this translation unit. */
#if defined(EXAMPLE_TWO) && defined(EXAMPLE_ONE)
#error "per-target defines leaked across targets"
#endif
#if !defined(EXAMPLE_TWO) && !defined(EXAMPLE_ONE)
#error "no per-target define reached the compiler"
#endif

__attribute__((section(".isr_vector"), used))
void (*const g_vectors[])(void) = { (void (*)(void))&_estack, Reset_Handler };
void Reset_Handler(void) { while (1) {} }
CFILE
ck "v2 configure" "0" "$(cd "$V2" && rcn v2_cfg f -m debug -y)"
mkdir -p "$V2/.vscode"
# Seeded with the keys a real user file has: one unrelated configuration PLUS
# top-level "inputs"/"compounds". Rebuilding the document from scratch would
# silently drop the latter two - this fixture is what proves it does not.
cat > "$V2/.vscode/launch.json" <<'JSON'
{
    "version": "0.2.0",
    "inputs": [
        { "id": "myInput", "type": "promptString", "description": "Custom input" }
    ],
    "compounds": [
        { "name": "My Compound", "configurations": [] }
    ],
    "configurations": [
        {
            "name": "My Custom Debug",
            "type": "cortex-debug"
        }
    ]
}
JSON
ck "v2 build two" "0" "$(cd "$V2" && rcn v2_two build two)"
ck "v2 build one" "0" "$(cd "$V2" && rcn v2_one build one)"
ckf "v2 two artifact" "$V2/build/cross/arm/debug/example-two.elf"
ckf "v2 one artifact" "$V2/build/cross/arm/debug/example-one.elf"
ckg "v2 launch has two cfg" "JLink Debug (two)" "$V2/.vscode/launch.json"
ckg "v2 launch has one cfg" "JLink Debug (one)" "$V2/.vscode/launch.json"
ckg "v2 unrelated user config preserved" "My Custom Debug" "$V2/.vscode/launch.json"
ck "v2 launch.json parses as JSON" "0" "$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$V2/.vscode/launch.json" >/dev/null 2>&1; echo $?)"
ck "v2 launch.json has 3 configs (1 user + 2 targets)" "3" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).configurations.length)" "$V2/.vscode/launch.json" 2>/dev/null)"
ckg "v2 top-level 'inputs' preserved" '"inputs"' "$V2/.vscode/launch.json"
ckg "v2 top-level 'compounds' preserved" '"compounds"' "$V2/.vscode/launch.json"
ckg "v2 custom input entry preserved" 'myInput' "$V2/.vscode/launch.json"
ck "v2 inputs survives as a JSON array of 1" "1" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).inputs.length)" "$V2/.vscode/launch.json" 2>/dev/null)"
printf '{\n    // comment allowed by VS Code\n    "version": "0.2.0",\n    "configurations": []\n}\n' > "$V2/.vscode/launch.json"
cp "$V2/.vscode/launch.json" "$BASE/v2_jsonc_before.json"
ck "v2 build with commented launch.json does not fail" "0" "$(cd "$V2" && rcn v2_jsonc build two)"
ck "v2 commented file left untouched" "0" "$(diff -q "$BASE/v2_jsonc_before.json" "$V2/.vscode/launch.json" >/dev/null 2>&1; echo $?)"
ckg "v2 warned instead of clobbering" "not plain JSON" "$BASE/v2_jsonc.log"
ck "v2 try/catch available inside after_build" "1" "$(grep -c 'not plain JSON' "$BASE/v2_jsonc.log")"

echo "--- v2 leak check: per-target defines must not bleed across targets ---"
# Deterministic, log-format independent: the v2 probe source fails to compile unless
# EXACTLY ONE per-target define arrives, so a successful rebuild is the assertion.
# (xmake's CLI is "[task] [options] [target]": a trailing -v after the target makes
# it print its usage screen - that is what broke the previous revision of this check.)
ck "v2 two rebuild: exactly its own define (no leak)" "0" "$(cd "$V2" && rcn v2_two_leak build -r two)"
ck "v2 one rebuild: exactly its own define (no leak)" "0" "$(cd "$V2" && rcn v2_one_leak build -r one)"
# Negative control: a target declaring BOTH defines must FAIL, proving the guard is
# live and the two passes above are not vacuous.
ck "v2 guard fires on a deliberate leak" "255" "$(cd "$V2" && rcn v2_both build -r both)"
ckg "v2 guard message names the leak" "leaked across targets" "$BASE/v2_both.log"

# ---------- v3 ----------
echo "--- v3: fallbacks for absent languages / float_abi ---"
V3="$BASE/v3"; newproj "$V3"
printf '{\n    "name": "ProbeNoLang",\n%s\n}\n' "$CFG_COMMON" > "$V3/.lua/config.json"
printf '{ "name": "plain", "defines": ["PLAIN"] }\n' > "$V3/.lua/targets/plain.json"
ck "v3 configure without languages/float_abi" "0" "$(cd "$V3" && rcn v3_cfg f -m debug -y)"
ck "v3 build plain" "0" "$(cd "$V3" && rcn v3_build build plain)"
ckf "v3 artifact" "$V3/build/cross/arm/debug/plain.elf"
ckg "v3 float_abi fallback = hard" "mfloat-abi=hard" "$V3/build/compile_commands.json"
ckg "v3 languages fallback = c17" "std=c17" "$V3/build/compile_commands.json"

# ---------- v4 ----------
echo "--- v4: back-compat: no targets dir, no name ---"
V4="$BASE/v4"; newproj "$V4"; rmdir "$V4/.lua/targets"
printf '{\n%s\n}\n' "$CFG_COMMON" > "$V4/.lua/config.json"
ck "v4 configure without targets dir" "0" "$(cd "$V4" && rcn v4_cfg f -m debug -y)"
ck "v4 build firmware" "0" "$(cd "$V4" && rcn v4_build build firmware)"
ckf "v4 artifact falls back to stem" "$V4/build/cross/arm/debug/firmware.elf"
ckf "v4 .bin extension replaced" "$V4/build/cross/arm/debug/firmware.bin"
ckg "v4 legacy launch name kept" "\"JLink Debug\"" "$V4/.vscode/launch.json"
ck "v4 no target suffix in legacy launch" "0" "$(grep -c 'JLink Debug (' "$V4/.vscode/launch.json")"

# ---------- v5 ----------
echo "--- v5: back-compat: no targets dir, name from config ---"
V5="$BASE/v5"; newproj "$V5"; rmdir "$V5/.lua/targets"
printf '{\n    "name": "Probe",\n%s\n}\n' "$CFG_COMMON" > "$V5/.lua/config.json"
ck "v5 configure" "0" "$(cd "$V5" && rcn v5_cfg f -m debug -y)"
ck "v5 build firmware" "0" "$(cd "$V5" && rcn v5_build build firmware)"
ckf "v5 legacy artifact keeps config name" "$V5/build/cross/arm/debug/Probe.elf"
ckg "v5 legacy launch name kept" "\"JLink Debug\"" "$V5/.vscode/launch.json"

# ---------- v6 ----------
echo "--- v6: clang_format regression guard ---"
V6="$BASE/v6"; newproj "$V6"
printf '{\n    "name": "ProbeCF",\n%s,\n    "float_abi": "hard",\n    "languages": { "c": "c11", "cpp": "c++17" },\n    "clang_format": { "BasedOnStyle": "LLVM", "IndentWidth": 4 }\n}\n' "$CFG_COMMON" > "$V6/.lua/config.json"
printf '{ "name": "cf", "defines": ["CF"] }\n' > "$V6/.lua/targets/cf.json"
ck "v6 configure" "0" "$(cd "$V6" && rcn v6_cfg f -m debug -y)"
ck "v6 build cf" "0" "$(cd "$V6" && rcn v6_build build cf)"
ckf "v6 .clang-format generated" "$V6/build/.clang-format"
ckg "v6 .clang-format content" "IndentWidth: 4" "$V6/build/.clang-format"
ckf "v6 .vscode/settings.json generated" "$V6/.vscode/settings.json"
ck "v6 settings.json is valid JSON" "0" "$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$V6/.vscode/settings.json" >/dev/null 2>&1; echo $?)"

# ---------- v7 ----------
echo "--- v7: missing mcu_core must give an actionable error ---"
V7="$BASE/v7"; newproj "$V7"
printf '{ "mcu_series": "STM32F412Rx", "ld_script": "probe.ld", "arm_gcc_path": "/usr", "sources": ["main.c"], "includedirs": ["."] }\n' > "$V7/.lua/config.json"
printf '{ "name": "nocore" }\n' > "$V7/.lua/targets/nocore.json"
# The guard lives in on_config, which runs during `xmake f` as well, so a project
# missing mcu_core fails fast at configure time with an actionable message. That is
# the intended behaviour; the expectation (not the guard) was wrong.
ck "v7 configure without mcu_core fails fast (on_config guard)" "255" "$(cd "$V7" && rcn v7_cfg f -m debug -y)"
ckg "v7 configure error is actionable too" "mcu_core is not set" "$BASE/v7_cfg.log"
ck "v7 build fails (expected)" "255" "$(cd "$V7" && rcn v7_build build nocore)"
ckg "v7 error names the missing field" "mcu_core is not set" "$BASE/v7_build.log"

# ---------- v8 ----------
# Legacy project (NO .lua/targets/) whose config.json has "name": "" - exactly what
# projectConfig.ts produces for a field the user never filled in. v4 covers the key
# being ABSENT; that is a different branch, so both fixtures are kept.
echo "--- v8: back-compat with an explicitly EMPTY name ---"
V8="$BASE/v8"; newproj "$V8"; rmdir "$V8/.lua/targets"
printf '{\n    "name": "",\n%s\n}\n' "$CFG_COMMON" > "$V8/.lua/config.json"
ck "v8 configure" "0" "$(cd "$V8" && rcn v8_cfg f -m debug -y)"
ck "v8 build firmware" "0" "$(cd "$V8" && rcn v8_build build firmware)"
ckf "v8 artifact falls back to the stem, not '.elf'" "$V8/build/cross/arm/debug/firmware.elf"
ckf "v8 .bin has a real name" "$V8/build/cross/arm/debug/firmware.bin"
cknf "v8 no nameless .elf artifact" "$V8/build/cross/arm/debug/.elf"
cknf "v8 no nameless .bin artifact" "$V8/build/cross/arm/debug/.bin"
ck "v8 launch.json is valid JSON" "0" "$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$V8/.vscode/launch.json" >/dev/null 2>&1; echo $?)"
ck "v8 launch.json points at firmware.elf" "1" "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.configurations[0].executable.endsWith('firmware.elf')?1:0)" "$V8/.vscode/launch.json" 2>/dev/null)"

# ---------- v9 ----------
# An EMPTY-STRING scalar in a target overlay. "" is truthy in Lua, so this used to reach
# GCC as the single argument -mfloat-abi= and die with "missing argument" (rc 255). Built
# with -v so the log carries the real compile line and the fallback can be asserted.
echo "--- v9: an empty-string float_abi in a target overlay ---"
V9="$BASE/v9"; newproj "$V9"
printf '{\n    "name": "V9",\n    "float_abi": ""\n}\n' > "$V9/.lua/targets/v9.json"
printf '{\n    "name": "V9",\n%s\n}\n' "$CFG_COMMON" > "$V9/.lua/config.json"
ck "v9 configure" "0" "$(cd "$V9" && rcn v9_cfg f -m debug -y)"
ck "v9 build with an empty float_abi (used to be rc 255)" "0" "$(cd "$V9" && rcn v9_build build -v v9)"
ckf "v9 artifact built" "$V9/build/cross/arm/debug/V9.elf"
ckg "v9 empty float_abi falls back to hard" "-mfloat-abi=hard" "$BASE/v9_build.log"

# ---------- v10 ----------
# A PARTIAL languages overlay must inherit the shared C++ standard. Taking the table
# wholesale made languages["cpp"] nil and reached target:set("languages", "c99", nil)
# with no error at all - a silent misconfiguration. Measured mapping: "c99" -> -std=c99,
# "c++20" -> -std=c++20, and both only reach GCC when a .cpp file is in the sources.
echo "--- v10: a partial languages overlay inherits the shared standard ---"
V10="$BASE/v10"; newproj "$V10"
printf '{\n    "name": "V10",\n    "languages": { "c": "c99" }\n}\n' > "$V10/.lua/targets/v10.json"
cat > "$V10/.lua/config.json" <<'JSON'
{
    "name": "V10",
    "mcu_series": "STM32F412Rx",
    "mcu_core": "cortex-m4",
    "mcu_device": "STM32F412RG",
    "ld_script": "probe.ld",
    "svd_file": "STM32F412.svd",
    "jlink_path": "/opt/SEGGER/JLink/JLinkExe",
    "arm_gcc_path": "/usr",
    "optimization": { "debug": "debug", "release": "release" },
    "languages": { "c": "c17", "cpp": "c++20" },
    "defines": ["PROBE_COMMON"],
    "includedirs": ["."],
    "sources": ["main.c", "extra.cpp"]
}
JSON
printf 'extern "C" void v10_extra(void) {}\n' > "$V10/extra.cpp"
ck "v10 configure" "0" "$(cd "$V10" && rcn v10_cfg f -m debug -y)"
ck "v10 build with a partial languages overlay" "0" "$(cd "$V10" && rcn v10_build build -v v10)"
ckf "v10 artifact built" "$V10/build/cross/arm/debug/V10.elf"
ckg "v10 cpp overlay inherits the shared c++20" "-std=c++20" "$BASE/v10_build.log"
ckg "v10 c overlay wins over the shared c17" "-std=c99" "$BASE/v10_build.log"

# ---------- v11 ----------
# An EMPTY-STRING mcu_series. It is consumed by target:add("defines", ...), and an empty
# value produced a bare -D on the compile line (rc 255). An ABSENT value is fine (rc 0),
# so this fixture pins the pick() empty-string rule for define-type fields too.
#
# The config is written WHOLE rather than appended to $CFG_COMMON: that variable already
# carries "mcu_series", so appending an empty one produced a duplicate JSON key whose
# last-wins resolution silently defeated the fixture.
echo "--- v11: an empty-string mcu_series in the shared config ---"
V11="$BASE/v11"; newproj "$V11"; rmdir "$V11/.lua/targets"
cat > "$V11/.lua/config.json" <<'JSON'
{
    "name": "V11",
    "mcu_series": "",
    "mcu_core": "cortex-m4",
    "mcu_device": "STM32F412RG",
    "ld_script": "probe.ld",
    "svd_file": "STM32F412.svd",
    "jlink_path": "/opt/SEGGER/JLink/JLinkExe",
    "arm_gcc_path": "/usr",
    "optimization": { "debug": "debug", "release": "release" },
    "defines": ["PROBE_COMMON"],
    "includedirs": ["."],
    "sources": ["main.c"]
}
JSON
ck "v11 configure" "0" "$(cd "$V11" && rcn v11_cfg f -m debug -y)"
ck "v11 build with an empty mcu_series (used to be rc 255)" "0" "$(cd "$V11" && rcn v11_build build -v firmware)"
ckf "v11 artifact built" "$V11/build/cross/arm/debug/V11.elf"
# A bare -D (a flag with no value) means an empty define reached the compiler. Anchored on
# a space or end-of-line so -DX / -DDEBUG / -ffunction-sections cannot match it.
ck "v11 no bare -D on the compile line" "0" "$(grep -cE -- ' -D( |$)' "$BASE/v11_build.log")"

# ---------- v12 ----------
# The FIRST-RUN shape: only mcu_core / ld_script / sources / includedirs filled in, every
# other string still "" - exactly what a freshly initialised project has before the user
# finishes the configuration panel. This used to build a valid ELF and then die in
# after_build (rc 255, "attempt to index a nil value (local 'jlink_gdb')") because
# path.normalize("") is nil. The assertion on serverpath is what actually pins the fix:
# rc alone would also pass if the fallback were merely made non-crashing but wrong.
echo "--- v12: first-run project (all optional strings still empty) ---"
V12="$BASE/v12"; newproj "$V12"; rmdir "$V12/.lua/targets"
cat > "$V12/.lua/config.json" <<'JSON'
{
    "name": "",
    "mcu_series": "",
    "mcu_core": "cortex-m4",
    "mcu_device": "",
    "ld_script": "probe.ld",
    "svd_file": "",
    "jlink_path": "",
    "arm_gcc_path": "/usr",
    "optimization": { "debug": "debug", "release": "release" },
    "float_abi": "hard",
    "languages": { "c": "c17", "cpp": "c++20" },
    "defines": [],
    "includedirs": ["."],
    "sources": ["main.c"]
}
JSON
ck "v12 configure" "0" "$(cd "$V12" && rcn v12_cfg f -m debug -y)"
ck "v12 build of a first-run project (used to be rc 255 in after_build)" "0" "$(cd "$V12" && rcn v12_build build -v firmware)"
ckf "v12 artifact built" "$V12/build/cross/arm/debug/firmware.elf"
ck "v12 launch.json is valid JSON" "0" "$(node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$V12/.vscode/launch.json" >/dev/null 2>&1; echo $?)"
ckf "v12 launch.json exists at all" "$V12/.vscode/launch.json"
ck "v12 serverpath falls back to JLinkGDBServerCL.exe" "1" "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.configurations[0].serverpath==='JLinkGDBServerCL.exe'?1:0)" "$V12/.vscode/launch.json" 2>/dev/null)"
ck "v12 executable points at the built ELF" "1" "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.configurations[0].executable.endsWith('firmware.elf')?1:0)" "$V12/.vscode/launch.json" 2>/dev/null)"
ck "v12 no nil-index crash in the build log" "0" "$(grep -cE "attempt to (index|concatenate) a nil" "$BASE/v12_build.log")"

# ---------- v13 ----------
# An empty ld_script must fail FAST and legibly at configure time. Before the guard it
# reached the linker as a bare "-T" (HEAD concatenated "" harmlessly), and once empty
# values counted as absent it became "attempt to concatenate a nil value".
echo "--- v13: an empty ld_script fails fast with an actionable message ---"
V13="$BASE/v13"; newproj "$V13"; rmdir "$V13/.lua/targets"
printf '{\n    "name": "V13",\n    "mcu_series": "STM32F412Rx",\n    "mcu_core": "cortex-m4",\n    "ld_script": "",\n    "arm_gcc_path": "/usr",\n    "optimization": { "debug": "debug", "release": "release" },\n    "defines": [],\n    "includedirs": ["."],\n    "sources": ["main.c"]\n}\n' > "$V13/.lua/config.json"
ck "v13 configure fails (non-zero)" "255" "$(cd "$V13" && rcn v13_cfg f -m debug -y)"
ckg "v13 guard message is actionable" "ld_script is not set" "$BASE/v13_cfg.log"
ck "v13 no cryptic nil-concat error" "0" "$(grep -cE "attempt to concatenate a nil" "$BASE/v13_cfg.log")"

# ---------- v14 ----------
# Pins the decision that must NOT change: a path that does not end in JLink.exe has
# always been collapsed to the bare JLinkGDBServerCL.exe (cortex-debug resolves it from
# PATH). Nothing asserted serverpath before, so the nil-guard rewrite could have started
# emitting /opt/SEGGER/JLink/JLinkExe verbatim - silently pointing the debugger at a
# different executable while every rc stayed 0.
echo "--- v14: a non-JLink.exe path still collapses to the bare server name ---"
V14="$BASE/v14"; newproj "$V14"; rmdir "$V14/.lua/targets"
cat > "$V14/.lua/config.json" <<'JSON'
{
    "name": "V14",
    "mcu_series": "STM32F412Rx",
    "mcu_core": "cortex-m4",
    "mcu_device": "STM32F412RG",
    "ld_script": "probe.ld",
    "svd_file": "STM32F412.svd",
    "jlink_path": "/opt/SEGGER/JLink/JLinkExe",
    "arm_gcc_path": "/usr",
    "optimization": { "debug": "debug", "release": "release" },
    "defines": ["PROBE_COMMON"],
    "includedirs": ["."],
    "sources": ["main.c"]
}
JSON
ck "v14 configure" "0" "$(cd "$V14" && rcn v14_cfg f -m debug -y)"
ck "v14 build" "0" "$(cd "$V14" && rcn v14_build build -v firmware)"
ck "v14 serverpath is the bare server name, not the JLinkExe path" "1" "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.configurations[0].serverpath==='JLinkGDBServerCL.exe'?1:0)" "$V14/.vscode/launch.json" 2>/dev/null)"

echo "=============================================="
echo "=== RESULT [$XM_NAME]: PASS=$PASS FAIL=$FAIL ==="
echo "=============================================="
[ "$FAIL" -eq 0 ] || exit 1
