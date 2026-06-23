import * as vscode from "vscode";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  OPTIMIZATION_PRESETS,
  ProjectConfig,
  getDefaultProjectConfig,
} from "./projectConfig";

/**
 * Promisified child_process.exec from the Node standard library.
 * The rejected error already carries `stdout`, `stderr`, `code`, `killed` and
 * `signal` properties, so no custom error wrapper is required.
 */
const execP = promisify(exec);

/**
 * Options accepted by the command execution helpers.
 */
export interface ExecOptions {
  cwd: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Read a typed value from the `xmake` configuration section.
 */
export function getWorkspaceConfig<T>(key: string, defaultValue: T): T {
  return vscode.workspace.getConfiguration("xmake").get(key, defaultValue);
}

/**
 * Path to the workspace root (first workspace folder).
 */
export function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Resolve the configured xmake executable path.
 */
export function getXmakePath(): string {
  return getWorkspaceConfig<string>("xmakePath", "xmake");
}

/**
 * Build a shell-safe xmake invocation, quoting the executable path if it
 * contains whitespace.
 */
export function buildXmakeCommand(args: string): string {
  const xmakePath = getXmakePath();
  const executable = xmakePath.includes(" ") ? `"${xmakePath}"` : xmakePath;
  return args ? `${executable} ${args}` : executable;
}

/**
 * Whether the given id matches a known optimization preset.
 */
export function isValidOptimizationPreset(id: string): boolean {
  return OPTIMIZATION_PRESETS.some((p) => p.id === id);
}

/**
 * Convert an unknown caught value into a human-readable message.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute a command asynchronously, returning stdout and stderr.
 *
 * Defaults: 2-minute timeout and a 10 MB output buffer.
 */
export function execAsync(
  command: string,
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execP(command, {
    cwd: options.cwd,
    timeout: options.timeout ?? 120000,
    env: options.env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Run a command and return its stdout (or stderr as a fallback),
 * swallowing errors. Useful for best-effort probes such as
 * `git submodule status`.
 */
export async function execSilent(
  command: string,
  options: ExecOptions,
): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, options);
    return stdout || stderr;
  } catch {
    return "";
  }
}

/**
 * Validation result interface.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Shell metacharacters that indicate a potential command-injection attempt.
 * Used to sanity-check values that flow into build commands.
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /`[^`]*`/, // Backtick command substitution
  /\$\([^)]*\)/, // $(...) command substitution
  /\$\{[^}]*\}/, // ${...} variable expansion
  /\|\s*\w+/, // Pipe to another command
  /;\s*\w+/, // Command separator
  /&&\s*\w+/, // AND operator
  /\|\|\s*\w+/, // OR operator
  />\s*\S/, // Output redirection
  /<\s*\S/, // Input redirection
];

/** Top-level string fields of a ProjectConfig. */
const STRING_FIELDS: readonly (keyof ProjectConfig)[] = [
  "name",
  "mcu_series",
  "mcu_core",
  "mcu_device",
  "ld_script",
  "svd_file",
  "jlink_path",
  "arm_gcc_path",
];

/** Top-level array fields of a ProjectConfig. */
const ARRAY_FIELDS: readonly (keyof ProjectConfig)[] = [
  "defines",
  "includedirs",
  "sources",
];

const isString = (v: unknown): v is string => typeof v === "string";
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.every((item): item is string => typeof item === "string");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate ProjectConfig data coming from an untrusted source (webview).
 * Ensures all fields exist with the correct types, optimization preset ids
 * are known, and that no value looks like a command-injection attempt.
 */
export function validateProjectConfig(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { valid: false, errors: ["Invalid data: expected an object"] };
  }

  for (const field of STRING_FIELDS) {
    const value = data[field];
    if (value !== undefined && !isString(value)) {
      errors.push(`Field '${field}' must be a string, got ${typeof value}`);
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = data[field];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      errors.push(`Field '${field}' must be an array, got ${typeof value}`);
      continue;
    }
    value.forEach((item, i) => {
      if (typeof item !== "string") {
        errors.push(
          `Field '${field}[${i}]' must be a string, got ${typeof item}`,
        );
      }
    });
  }

  // Optional post-build command: type check only.
  if (data.postbuild !== undefined && !isString(data.postbuild)) {
    errors.push("Field 'postbuild' must be a string");
  }

  // Optional clang_format: must be an object if present.
  if (data.clang_format !== undefined && !isRecord(data.clang_format)) {
    errors.push("Field 'clang_format' must be an object");
  }

  // Optimization selection
  if (data.optimization !== undefined) {
    if (!isRecord(data.optimization)) {
      errors.push("Field 'optimization' must be an object");
    } else {
      for (const mode of ["debug", "release"] as const) {
        const id = data.optimization[mode];
        if (
          id !== undefined &&
          (typeof id !== "string" || !isValidOptimizationPreset(id))
        ) {
          errors.push(`Invalid optimization.${mode} preset: ${String(id)}`);
        }
      }
    }
  }

  // Collect every provided string value and run the injection check once.
  const allStrings: string[] = [
    ...STRING_FIELDS.map((f) => data[f]).filter(isString),
    ...ARRAY_FIELDS.flatMap((f) => {
      const v = data[f];
      return isStringArray(v) ? v : [];
    }),
  ];

  for (const str of allStrings) {
    if (str.length === 0) {
      continue;
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(str)) {
        errors.push(
          `Potential command injection detected in value: ${str.substring(0, 50)}...`,
        );
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Safely coerce unknown data into a fully-typed ProjectConfig, applying
 * defaults for missing or invalid fields.
 */
export function toProjectConfig(data: unknown): ProjectConfig {
  if (!isRecord(data)) {
    return getDefaultProjectConfig();
  }

  const optimization = isRecord(data.optimization) ? data.optimization : {};
  const debugId = isString(optimization.debug) ? optimization.debug : "debug";
  const releaseId = isString(optimization.release)
    ? optimization.release
    : "release";
  const valid = (id: string): string =>
    isValidOptimizationPreset(id) ? id : "debug";

  const clangFormat = isRecord(data.clang_format)
    ? (data.clang_format as Record<string, string | number | boolean>)
    : undefined;

  return {
    name: isString(data.name) ? data.name : "",
    mcu_series: isString(data.mcu_series) ? data.mcu_series : "",
    mcu_core: isString(data.mcu_core) ? data.mcu_core : "",
    mcu_device: isString(data.mcu_device) ? data.mcu_device : "",
    ld_script: isString(data.ld_script) ? data.ld_script : "",
    svd_file: isString(data.svd_file) ? data.svd_file : "",
    jlink_path: isString(data.jlink_path) ? data.jlink_path : "",
    arm_gcc_path: isString(data.arm_gcc_path) ? data.arm_gcc_path : "",
    optimization: { debug: valid(debugId), release: valid(releaseId) },
    defines: isStringArray(data.defines) ? data.defines : [],
    includedirs: isStringArray(data.includedirs) ? data.includedirs : [],
    sources: isStringArray(data.sources) ? data.sources : [],
    postbuild: isString(data.postbuild) ? data.postbuild : undefined,
    clang_format: clangFormat,
  };
}
