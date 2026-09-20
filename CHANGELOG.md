# Change Log

All notable changes to the "Xbuild MCU" extension will be documented in this file.

## [2.1.0] - 2026-09-20
### Added
- **Multi-target builds.** A project can define several build targets, one JSON file per target in `.lua/targets/` (e.g. `bootloader.json`, `application.json`). Target files are additive overrides of `.lua/config.json`: shared fields are inherited, `defines`/`includedirs`/`sources` extend the shared lists, scalar fields override them.
- Active-target selection as a second axis next to debug/release: status-bar item, tree-view entry, quick-pick command `Xmake: Select Build Target` (`Ctrl+Alt+T`), persisted per workspace. `Build`/`Rebuild`/`Clean`/`Flash` all act on the selected target only.
- `Xmake: Add Build Target` command: scaffolds `.lua/targets/<name>.json` from the shared settings.
- **Custom task support.** Tasks a project defines itself (anything under `.lua/tasks/` that the extension does not ship) are discovered by static scan and listed in a `Project Tasks` subcategory in the Actions view, with `Xmake: Run Project Task` for the command palette. A task that declares a `target` option is invoked with `--target=<active target>`.
- `audit.lua` task: audits a built image (exit machinery, guard variables, pre-main initialisation, heap usage, 64-bit division, vtables, RAM budget) and exits non-zero when a check fails. Shipped as a resource but deliberately **not** part of the required task set, so it never triggers a "restore missing files" prompt.

### Changed
- `xmake.lua` template is now a generic engine: it creates one xmake target per file in `.lua/targets/` and knows no project-specific target name. With no target file present it still builds a single `firmware` target from `.lua/config.json`, so existing single-image projects keep working unchanged.
- Project initialization now seeds `.lua/targets/firmware.json` (named after the project, so the artifact stays `<ProjectName>.elf`, or `firmware.elf` while the name is empty). Existing target files are never overwritten.
- Config schema: added `float_abi` (default `hard`) and `languages` (`c`/`cpp` standards, default `c17`/`c++20`). Both editable via the panel and validated like the other fields.
- VS Code task catalog is now target-explicit: every build/clean/rebuild/flash task names the target, so it no longer builds all targets at once. `tasks.json` entries may pass an optional `target`.
- `.vscode/launch.json` is merged keyed by target (`JLink Debug (<target>)`) instead of being overwritten: with several targets the debugger used to point at whichever built last. Unrelated configurations and top-level keys (`inputs`, `compounds`) are preserved; a file with comments is left untouched.

### Fixed
- **Backward compatibility:** the multi-target template referenced a `raise()` that does not exist at `xmake.lua` top level, so a project without `.lua/targets/` failed to load with a misleading error. It now falls back to a single `firmware` target.
- `xmake flash` rejected `--target=...`: the flag was declared as a bare `target = true` in `set_menu`, which xmake ignores. It is now a real option, and the task reports an error instead of guessing when several targets exist.
- Target-aware post-build: the `postbuild` command receives the real artifact paths via `{target}`, `{bin}` and `{elf}` tokens, so a path baked into `config.json` no longer breaks release builds. Requires passing `{bin}`/`{elf}` instead of a hardcoded `build/cross/arm/debug/...` path.
- A missing `mcu_core` produced an obscure Lua nil error while building flags; it now fails fast with an actionable message.
- Memory report after a build used every ELF found under `build/`; it now prefers the active target's artifact so a multi-target build does not mix boards in one table.
- A `tasks.json` entry resolved through the VS Code Task API built the **first** target on disk instead of the selected one: the resolver fell back to the alphabetically-first `.lua/targets/*.json` stem, so such a task and the status bar could disagree. It now honours the active target (an explicit `target` in the task definition still wins, as in 2.0.1). Residual limitation: the `Run Task` list itself is populated by VS Code and may keep showing the previously selected target until it re-queries — there is no `onDidChangeTasks` event to trigger that, so the list is rebuilt on every query and the entry's own command always uses the current target.
- Phantom VS Code tasks `configure` and `rebuild` (`error: invalid task`, exit 255) are replaced by `xmake f -y` and `xmake -r`.
- Task chains used `&&` unconditionally, which PowerShell 5.1 rejects; the separator is now shell-aware in one shared helper.
- An empty string in a scalar setting broke the build instead of being treated as "unset": `"float_abi": ""` reached GCC as the single argument `-mfloat-abi=` ("missing argument to '-mfloat-abi='") and `"mcu_series": ""` produced a bare `-D`. Empty strings now count as absent for every overlaid setting.
- A **partial** `languages` override (`{"languages": {"c": "c99"}}`) silently dropped the inherited C++ standard, because the overlay took the table wholesale and left the other key `nil`; standards now fall back key by key.
- A project whose `jlink_path` was still empty crashed the post-build step with `attempt to index a nil value` **after** producing a valid ELF: `path.normalize("")` returns `nil`, and the result was passed straight to `gsub`, which made the intended `JLinkGDBServerCL.exe` fallback unreachable. A freshly initialised project takes exactly this path. Inherited from 2.0.1 (its launch.json writer had the same shape and the same empty default). The fallback is now reachable, and the launch configuration is written with the server default instead of failing.
- A missing `ld_script` now fails the configure step with an actionable message, rather than reaching the linker as a bare `-T`.
- A project whose `name` was left empty produced artifacts literally called `.elf`/`.bin` (and a debug configuration pointing at a path ending in `/.elf`), because an empty string is truthy in Lua. An empty name now falls back to `firmware`, as an absent one always did. Inherited from 2.0.1.

## [2.0.1] - 2026-06-23
### Fixed
- A partially initialized project (e.g. `xmake.lua` exists but `.lua/config.json` or some `.lua/tasks/*.lua` are missing) is now detected. The tree view shows the init entry whenever the project is not fully complete — labelled "Initialize Project" (icon `add`) when `xmake.lua` is absent, or "Restore missing project files" (icon `sync`) when `xmake.lua` exists but other files are missing.
- `XmakeManager.isProjectInitialized()` (xmake.lua-only check) replaced by `isProjectComplete()` (xmake.lua + `.lua/config.json` + all `.lua/tasks/*.lua`). Added `hasXmakeFile()` for the entry label.
- `XmakeTemplate.createProjectFiles()` is now non-destructive for an existing `xmake.lua` — it is only written when absent; the overwrite prompt was removed. Missing `.lua/config.json` and `.lua/tasks/*.lua` are restored in place. (The list of task files moved to `projectConfig.ts` as `TASK_FILES`, shared by the manager and the template.)
- Obsolete "Create xmake.lua + config.json" banner/button and its handler removed from the configuration panel; project bootstrap is handled solely by the tree view's init action (`xmake.init`).

## [2.0.0] - 2026-06-22
### ⚠️ Breaking changes
- Project configuration moved from `xmake.lua` locals to `.lua/config.json`. Existing projects must migrate their `local` variables into `.lua/config.json` (use the panel's “Create xmake.lua + config.json” action to bootstrap, then fill in values). The bundled `xmake-template.lua` now reads `.lua/config.json`.
- `arm_gcc_path` toolchain path now lives in `.lua/config.json` (was a `local` in xmake.lua). Editable via the panel (Paths tab → ARM GCC Path). The xmake toolchain reads it via its own `on_load`.
- `xmake.jlinkPath` VS Code setting removed; `jlink_path` is now configured via the extension panel (Paths tab) and stored in `.lua/config.json`.
- xmake tasks `cubemx`/`docs`/`flash`/`template` moved out of `xmake.lua` into `.lua/tasks/*.lua`, loaded via `includes(".lua/tasks/*.lua")`. `debug`/`release` remain inline in `xmake.lua`.

### Changed
- Extension now reads and writes project parameters to `.lua/config.json`. Schema: `name`, `mcu_series`, `mcu_core`, `mcu_device`, `ld_script`, `svd_file`, `jlink_path`, `arm_gcc_path`, `optimization.{debug,release}`, `defines`, `includedirs`, `sources`, optional `postbuild`, optional `clang_format`.
- `postbuild` and `clang_format` are optional and may be empty/absent. `postbuild` is written only when non-empty (so xmake's `if target:data("postbuild")` stays false); it is a legitimate shell command and is NOT run through the command-injection filter.
- Replaced `xmakeConfigParser.ts` (Lua-variable parser) with `projectConfig.ts` (`ProjectConfig` type, `ProjectConfigStore`, `readProjectConfig`, `getDefaultProjectConfig`, `mergeDefaults`). The store preserves unknown/optional fields (`clang_format`, `postbuild`, future additions) on write.
- Rewrote the configuration webview (`xmakePanelHtml.ts`) for the new schema: snake_case field ids, nested `optimization.debug/release` selects, `arm_gcc_path`, `jlink_path` and `postbuild` fields in the Paths tab, banner reports missing `.lua/config.json`.
- `XmakeManager.flash()` reads `jlink_path` from `.lua/config.json` and passes `--speed` to the `xmake flash` task.
- `memoryAnalyzer` resolves the linker script from `.lua/config.json` (`ld_script`).
- `XmakeTemplate.createProjectFiles()` now creates `xmake.lua`, `.lua/config.json` (defaults) and bootstraps `.lua/tasks/*.lua` from shipped resources (existing task files are preserved).
- Replaced `resources/xmake-template.lua` with the final config.json-driven xmake.lua. Added `resources/tasks/{cubemx,docs,flash,template}.lua`.
- `validateXmakeConfig`/`toXmakeConfig` renamed to `validateProjectConfig`/`toProjectConfig`.

### Fixed
- The extension no longer stays dormant in projects without `xmake.lua`. Activation events now also cover `.lua/config.json` and CubeMX `**/*.ioc`, and the new `Xmake: Initialize Project` command is available from the Command Palette in any workspace.
- The main tree view now shows an "Initialize Project" entry (creates `xmake.lua` + `.lua/config.json` + `.lua/tasks/`) when the project has not been bootstrapped yet, and switches to the regular build actions once `xmake.lua` exists.
- `svd_file` from `.lua/config.json` is now propagated to `target:data` in `on_load`, so it reaches `.vscode/launch.json` (`svdFile`).

### Removed
- `xmake.jlinkPath` VS Code setting (path moved to `.lua/config.json`).
- `xmakeConfigParser.ts` (Lua parsing no longer needed).

## [1.4.3] - 2026-06-22
### Changed
- Total refactoring: eliminated duplication, reused shared modules across the codebase.
- Switched to `node:` prefixed imports and `fs/promises` async API in `XmakeTemplate`.
- Replaced custom `execAsync`/`ExecError` with the standard `util.promisify(exec)`.
- Extracted shared helpers in `utils.ts`: `buildXmakeCommand`, `getWorkspaceConfig`, `getWorkspacePath`, `isValidOptimizationPreset`, `getErrorMessage`.
- Unified default config via `getDefaultXmakeConfig()`; single source of truth.
- Merged `createTask`/`createCompoundTask` into one method in `XmakeManager`.
- Simplified `extension.ts` (`deactivate` now relies on `context.subscriptions`); removed the undeclared `xmake.refresh` command.
- Hardened `escapeHtml` (escapes `'`).
- Unified modern code style across all files.

### Removed
- Dead code: `createTreeItemDefinition`, `Logger.setShowIn*/clear`, `XmakeManager.setModeSync/getLastBuildError`, `XmakeStatusBar.resetStatus`.
- Made internal `updateModeItem/updateStatusItem` private; fields marked `readonly`.

## [1.4.2] - 2026-04-25
### Added
- Added comments for some fields.
### Fixed
- Fixed JLink "ERROR: JLink flash failed (exit code: nil)" after successful flashing.
- Fixed name for GCC Path in UI
- Rename `STM32_SDK` to `ARM_GCC`

### Action required: Update xmake.lua.
- Change `STM32_SDK` -> `ARM_GCC`.
- Apply JLink patch: change `if ok ~= 0 then` to `if ok and ok ~= 0 then` to handle nil values.

## [1.4.1] - 2026-02-21
### Added
- Added "Submodule Configuration" section to README.

## [1.4.0] - 2026-02-19
### Added
- Added different optimization presets for Debug and Release modes.

  | ID | Name | GCC flags | Debug | LTO | Description |
  |----|----------|-----------|-------|-----|-------------|
  | `debug` | Debug | `-O0` | -g3 | ❌ | No optimization, full debug info |
  | `debug-optimized` | Debug Optimized | `-Og` | -g3 | ❌ | Optimized for debugging |
  | `balanced` | Balanced | `-O1` | -g2 | ❌ | Basic optimization |
  | `release` | Release Size | `-Os` | -g1 | ❌ | Optimized for size |
  | `speed` | Release Speed | `-O2` | -g1 | ❌ | Optimized for speed |
  | `speed-max` | Maximum Speed | `-O3` | -g0 | ❌ | Maximum speed optimization |
  | `size-max` | Maximum Size | `-Oz` | -g0 | ❌ | Maximum size optimization |
  | `release-lto` | Release with LTO | `-Os` | -g1 | ✅ | Size optimization with LTO |

## [1.3.3] - 2026-02-19
### Fixed
- Fixed `NodeJS.Timeout` type in the statusBar → switched to `ReturnType<typeof setTimeout>` for cross-platform support.
- Fixed incorrect PowerShell Detection → improved checking of `SHELL`, `PSModulePath`, `ComSpec`.
- Fixed memory leak in XmakeConfigPanel → improved `dispose()`, implemented `vscode.Disposable`.

### Changed
- Refactored XmakeManager → added `createTask()`, `createCompoundTask()`, `getCommandSeparator()` methods.
- Optimized `xmakePanelHtml.ts` → MCU presets are rendered in `MCU_PRESETS`, CSS/JS are separated.
- Fixed race condition → added protection in `extension.ts`, flag `isActivated`, checks `state`.

### Security
- `execAsync` - added timeout, maxBuffer, improved error handling.
- `validateXmakeConfig` - enhanced checks for command injection.
- All `EventEmitter` and subscriptions are correctly released.

## [1.3.2] - 2026-02-18
### Added
- Added Memory Usage Summary.

### Changed
- List of submodules moved to VSCode User Settings.
- Fixed PowerShell error in rebuild command.
- Fixed `xmake-template.lua` (paths & doxygen generating).

## [1.3.0] - 2026-02-17
### Changed
- Updated structure of all files.
- Fixed submodule removing logic.
- Switched to Tasks API instead of Terminal.
- Updated logging & Status Bar.
- Fixes in xmake.lua parser.
- Fixed error in generated xmake.lua file.
- Fixed duplicated fields in configuration window.

## [1.2.0] - 2026-02-17
### Changed
- Full refactoring.

## [1.1.0] - 2026-02-16
### Added
- Added generation of default xmake.lua from interface.
- Added submodule initialization from interface.

### Changed
- Updated interface.

## [1.0.0] - 2026-02-14
- Internal development versions (pre-release).
