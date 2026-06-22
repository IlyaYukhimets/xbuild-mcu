import * as vscode from "vscode";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  OPTIMIZATION_PRESETS,
  XmakeConfig,
  getDefaultXmakeConfig,
} from "./xmakeConfigParser";

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
 * Defaults: 2-minute timeout and a 10 MB output buffer, matching the
 * previous implementation.
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
 * Validation result interface
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

/**
 * XmakeConfig string fields and their array counterparts.
 */
const STRING_FIELDS: readonly (keyof XmakeConfig)[] = [
  "PROJECT_NAME",
  "MCU_SERIES",
  "MCU_CORE",
  "MCU_DEVICE",
  "LD_SCRIPT",
  "SVD_FILE",
  "JLINK_PATH",
  "ARM_GCC",
  "OPTIMIZATION_DEBUG",
  "OPTIMIZATION_RELEASE",
];

const ARRAY_FIELDS: readonly (keyof XmakeConfig)[] = [
  "DEFINES",
  "INCLUDE_DIRS",
  "SOURCE_FILES",
];

/**
 * Validate XmakeConfig data coming from an untrusted source (webview).
 * Ensures all fields exist with the correct types and that no value
 * looks like a command-injection attempt.
 */
export function validateXmakeConfig(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Invalid data: expected an object"] };
  }

  const config = data as Record<string, unknown>;

  for (const field of STRING_FIELDS) {
    const value = config[field];
    if (value !== undefined && typeof value !== "string") {
      errors.push(`Field '${field}' must be a string, got ${typeof value}`);
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = config[field];
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

  for (const field of ["OPTIMIZATION_DEBUG", "OPTIMIZATION_RELEASE"] as const) {
    const value = config[field];
    if (typeof value === "string" && !isValidOptimizationPreset(value)) {
      errors.push(`Invalid ${field} preset: ${value}`);
    }
  }

  // Collect every provided string value and run the injection check once.
  const allStrings: string[] = [
    ...STRING_FIELDS.map((f) => config[f]).filter(
      (s): s is string => typeof s === "string",
    ),
    ...ARRAY_FIELDS.flatMap((f) => {
      const v = config[f];
      return Array.isArray(v)
        ? (v.filter((s): s is string => typeof s === "string") as string[])
        : [];
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
 * Safely coerce unknown data into a fully-typed XmakeConfig, applying
 * defaults for missing or invalid fields.
 */
export function toXmakeConfig(data: unknown): XmakeConfig {
  if (!data || typeof data !== "object") {
    return getDefaultXmakeConfig();
  }

  const partial = data as Partial<XmakeConfig>;
  const isString = (v: unknown): v is string => typeof v === "string";
  const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) &&
    v.every((item): item is string => typeof item === "string");

  const debugPreset =
    isString(partial.OPTIMIZATION_DEBUG) &&
    isValidOptimizationPreset(partial.OPTIMIZATION_DEBUG)
      ? partial.OPTIMIZATION_DEBUG
      : "debug";
  const releasePreset =
    isString(partial.OPTIMIZATION_RELEASE) &&
    isValidOptimizationPreset(partial.OPTIMIZATION_RELEASE)
      ? partial.OPTIMIZATION_RELEASE
      : "release";

  return {
    PROJECT_NAME: partial.PROJECT_NAME ?? "",
    MCU_SERIES: partial.MCU_SERIES ?? "",
    MCU_CORE: partial.MCU_CORE ?? "",
    MCU_DEVICE: partial.MCU_DEVICE ?? "",
    LD_SCRIPT: partial.LD_SCRIPT ?? "",
    SVD_FILE: partial.SVD_FILE ?? "",
    JLINK_PATH: partial.JLINK_PATH ?? "",
    ARM_GCC: partial.ARM_GCC ?? "",
    DEFINES: isStringArray(partial.DEFINES) ? partial.DEFINES : [],
    INCLUDE_DIRS: isStringArray(partial.INCLUDE_DIRS)
      ? partial.INCLUDE_DIRS
      : [],
    SOURCE_FILES: isStringArray(partial.SOURCE_FILES)
      ? partial.SOURCE_FILES
      : [],
    OPTIMIZATION_DEBUG: debugPreset,
    OPTIMIZATION_RELEASE: releasePreset,
  };
}
