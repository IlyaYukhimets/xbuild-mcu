# Change Log

All notable changes to the "Xbuild MCU" extension will be documented in this file.

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
