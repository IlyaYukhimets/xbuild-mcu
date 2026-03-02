# Change Log

All notable changes to the "Xbuild MCU" extension will be documented in this file.

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
