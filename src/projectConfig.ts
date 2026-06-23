import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Optimization preset definition.
 * Based on GCC optimization levels and STM32CubeIDE equivalents.
 */
export interface OptimizationPreset {
  id: string;
  name: string;
  description: string;
  cflags: string;
  cxxflags: string;
  debugLevel: number;
  lto: boolean;
}

/**
 * Available optimization presets.
 */
export const OPTIMIZATION_PRESETS: readonly OptimizationPreset[] = [
  {
    id: "debug",
    name: "Debug",
    description:
      "No optimization, full debug info. Best for initial development.",
    cflags: "-O0",
    cxxflags: "-O0",
    debugLevel: 3,
    lto: false,
  },
  {
    id: "debug-optimized",
    name: "Debug Optimized (-Og)",
    description:
      "Optimized for debugging. Good balance of speed and debug capability.",
    cflags: "-Og",
    cxxflags: "-Og",
    debugLevel: 3,
    lto: false,
  },
  {
    id: "balanced",
    name: "Balanced (-O1)",
    description:
      "Basic optimization with moderate debug info. Good for everyday development.",
    cflags: "-O1",
    cxxflags: "-O1",
    debugLevel: 2,
    lto: false,
  },
  {
    id: "release",
    name: "Release Size (-Os)",
    description:
      "Optimized for size with minimal debug info. Standard release build.",
    cflags: "-Os",
    cxxflags: "-Os",
    debugLevel: 1,
    lto: false,
  },
  {
    id: "speed",
    name: "Release Speed (-O2)",
    description: "Optimized for speed with minimal debug info.",
    cflags: "-O2",
    cxxflags: "-O2",
    debugLevel: 1,
    lto: false,
  },
  {
    id: "speed-max",
    name: "Maximum Speed (-O3)",
    description:
      "Maximum speed optimization, no debug info. For production builds.",
    cflags: "-O3",
    cxxflags: "-O3",
    debugLevel: 0,
    lto: false,
  },
  {
    id: "size-max",
    name: "Maximum Size (-Oz)",
    description:
      "Maximum size optimization, no debug info. For constrained flash.",
    cflags: "-Oz",
    cxxflags: "-Oz",
    debugLevel: 0,
    lto: false,
  },
  {
    id: "release-lto",
    name: "Release with LTO",
    description:
      "Size optimization with Link Time Optimization. Best code density.",
    cflags: "-Os",
    cxxflags: "-Os",
    debugLevel: 1,
    lto: true,
  },
];

/** Get an optimization preset by id, falling back to the first one. */
export function getOptimizationPreset(id: string): OptimizationPreset {
  return (
    OPTIMIZATION_PRESETS.find((p) => p.id === id) ?? OPTIMIZATION_PRESETS[0]
  );
}

/**
 * Optimization level selection per build mode.
 */
export interface OptimizationSelection {
  debug: string;
  release: string;
}

/**
 * Project configuration mirroring the `.lua/config.json` schema consumed by
 * the xmake.lua template.
 */
export interface ProjectConfig {
  name: string;
  mcu_series: string;
  mcu_core: string;
  mcu_device: string;
  ld_script: string;
  svd_file: string;
  jlink_path: string;
  arm_gcc_path: string;
  optimization: OptimizationSelection;
  defines: string[];
  includedirs: string[];
  sources: string[];
  /** Optional post-build shell command (run by xmake after_build). */
  postbuild?: string;
  /** Optional clang-format settings; preserved but not edited by the panel. */
  clang_format?: Record<string, string | number | boolean>;
}

/** Directory and file used to store the project configuration. */
export const CONFIG_DIR = ".lua";
export const CONFIG_FILE = "config.json";

/** Resolve the absolute path of `.lua/config.json` inside a workspace. */
export function getProjectConfigPath(workspacePath: string): string {
  return join(workspacePath, CONFIG_DIR, CONFIG_FILE);
}

/**
 * Default project configuration used as a base for reads and validation.
 * Single source of truth for the "empty" config shape.
 */
export function getDefaultProjectConfig(): ProjectConfig {
  return {
    name: "",
    mcu_series: "",
    mcu_core: "",
    mcu_device: "",
    ld_script: "",
    svd_file: "",
    jlink_path: "",
    arm_gcc_path: "",
    optimization: { debug: "debug", release: "release" },
    defines: [],
    includedirs: [],
    sources: [],
  };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.every((item): item is string => typeof item === "string");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Merge a raw parsed JSON value into a fully-typed `ProjectConfig`,
 * applying defaults for missing or invalid fields and validating the
 * optimization preset ids.
 */
export function mergeDefaults(raw: unknown): ProjectConfig {
  const obj = isRecord(raw) ? raw : {};

  const optimization = isRecord(obj.optimization) ? obj.optimization : {};
  const debugId = isString(optimization.debug) ? optimization.debug : "debug";
  const releaseId = isString(optimization.release)
    ? optimization.release
    : "release";
  const valid = (id: string): string =>
    OPTIMIZATION_PRESETS.some((p) => p.id === id) ? id : "debug";

  return {
    name: isString(obj.name) ? obj.name : "",
    mcu_series: isString(obj.mcu_series) ? obj.mcu_series : "",
    mcu_core: isString(obj.mcu_core) ? obj.mcu_core : "",
    mcu_device: isString(obj.mcu_device) ? obj.mcu_device : "",
    ld_script: isString(obj.ld_script) ? obj.ld_script : "",
    svd_file: isString(obj.svd_file) ? obj.svd_file : "",
    jlink_path: isString(obj.jlink_path) ? obj.jlink_path : "",
    arm_gcc_path: isString(obj.arm_gcc_path) ? obj.arm_gcc_path : "",
    optimization: { debug: valid(debugId), release: valid(releaseId) },
    defines: isStringArray(obj.defines) ? obj.defines : [],
    includedirs: isStringArray(obj.includedirs) ? obj.includedirs : [],
    sources: isStringArray(obj.sources) ? obj.sources : [],
    postbuild: isString(obj.postbuild) ? obj.postbuild : undefined,
    clang_format: isRecord(obj.clang_format)
      ? (obj.clang_format as Record<string, string | number | boolean>)
      : undefined,
  };
}

/**
 * Read and parse `.lua/config.json` for a workspace, returning a typed
 * config with defaults applied. Returns the default config if the file is
 * missing or unreadable.
 */
export function readProjectConfig(workspacePath: string): ProjectConfig {
  const configPath = getProjectConfigPath(workspacePath);
  if (!existsSync(configPath)) {
    return getDefaultProjectConfig();
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    return mergeDefaults(JSON.parse(content));
  } catch {
    return getDefaultProjectConfig();
  }
}

/**
 * Store backing the configuration webview panel. Reads preserve unknown
 * fields (e.g. `clang_format` and future additions); writes merge the edited
 * known fields back into the last-read raw object so nothing is lost.
 */
export class ProjectConfigStore {
  private readonly configPath: string;
  private raw: Record<string, unknown> | undefined;

  constructor(private readonly workspacePath: string) {
    this.configPath = getProjectConfigPath(workspacePath);
  }

  /** Whether `.lua/config.json` exists. */
  public exists(): boolean {
    return existsSync(this.configPath);
  }

  /** Read and return the typed config, caching the raw object for writes. */
  public read(): ProjectConfig {
    if (!existsSync(this.configPath)) {
      this.raw = undefined;
      return getDefaultProjectConfig();
    }
    try {
      const content = readFileSync(this.configPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      this.raw = isRecord(parsed) ? { ...parsed } : undefined;
      return mergeDefaults(parsed);
    } catch {
      this.raw = undefined;
      return getDefaultProjectConfig();
    }
  }

  /**
   * Write the config to `.lua/config.json`, preserving any unknown fields
   * from the last `read()`. Creates the `.lua` directory if needed.
   */
  public write(config: ProjectConfig): boolean {
    try {
      const base: Record<string, unknown> = this.raw ?? {};

      base.name = config.name;
      base.mcu_series = config.mcu_series;
      base.mcu_core = config.mcu_core;
      base.mcu_device = config.mcu_device;
      base.ld_script = config.ld_script;
      base.svd_file = config.svd_file;
      base.jlink_path = config.jlink_path;
      base.arm_gcc_path = config.arm_gcc_path;
      base.optimization = config.optimization;
      base.defines = config.defines;
      base.includedirs = config.includedirs;
      base.sources = config.sources;
      // postbuild is optional: write only when non-empty, otherwise drop it
      // so xmake's `if target:data("postbuild") then` stays false.
      if (config.postbuild) {
        base.postbuild = config.postbuild;
      } else {
        delete base.postbuild;
      }
      if (config.clang_format !== undefined) {
        base.clang_format = config.clang_format;
      }

      mkdirSync(dirname(this.configPath), { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(base, null, 4), "utf-8");
      // Refresh the cached raw so a subsequent write stays consistent.
      this.raw = base;
      return true;
    } catch (error) {
      console.error("Failed to write .lua/config.json:", error);
      return false;
    }
  }
}
