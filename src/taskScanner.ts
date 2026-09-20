import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR, TASK_FILES } from "./projectConfig";

/**
 * A task the project itself defines, i.e. one the extension does not ship.
 */
export interface CustomTask {
  /** Task id as written in `task("...")`. */
  name: string;
  /** Description scraped from `set_menu`, when present. Tooltip only. */
  description: string;
  /** File the task was found in, relative to the workspace. */
  file: string;
  /**
   * Whether the task declares a `target` option in its `set_menu`.
   *
   * Only such a task may be invoked with `--target=<active>`: xmake rejects an
   * option a task never declared, so appending it unconditionally would turn a
   * working button into "error: Invalid option: --target=...".
   */
  acceptsTarget: boolean;
}

/**
 * Task ids the extension ships or relies on. Anything else found on disk is a
 * project-authored task and gets its own entry in the UI.
 */
const SHIPPED_TASKS: ReadonlySet<string> = new Set([
  ...TASK_FILES.map((file) => file.replace(/\.lua$/i, "")),
  "debug",
  "release",
]);

/**
 * xmake's own task names. A project task that shadowed one of these would make the
 * corresponding built-in action unreachable, so they are never surfaced as custom.
 */
const RESERVED_TASKS: ReadonlySet<string> = new Set([
  "build", "clean", "config", "f", "help", "install", "package", "require",
  "run", "show", "uninstall", "update", "create", "global", "repo", "service",
]);

/**
 * Top-level task definition. Anchored to the start of a line (leading whitespace
 * allowed) so it matches `task("audit")` only - and never `task_end()`, which has
 * no `(` directly after `task`.
 */
const TASK_RE = /^[ \t]*task\s*\(\s*["']([^"']+)["']/gm;

/**
 * Task ids that can safely become a command line. A name with whitespace or shell
 * metacharacters would produce a broken `xmake <name>` invocation, so such a task is
 * kept out of the UI rather than offered and then failing when clicked.
 */
const TASK_NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * A `target` entry in the task's `set_menu { options = { ... } }` list, e.g.
 * `{nil, "target", "kv", nil, "target to flash"}`. Only value-taking types are
 * honoured; a bare boolean `target` flag would not accept `--target=<name>`.
 */
const TARGET_OPTION_RE = /\{\s*[^,{}]*,\s*["']target["']\s*,\s*["'](?:kv|string)["']/;

/** `description = "..."` inside the task's `set_menu { ... }` block. */
const DESCRIPTION_RE = /description\s*=\s*["']([^"']*)["']/;

/** Read a file as text, returning "" when it cannot be read. */
function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extract the top-level task ids defined in one Lua source.
 *
 * Static, offline scanning is the primary discovery path on purpose: it is instant,
 * works before the project has ever been configured, and needs no xmake process.
 * The alternatives were measured and rejected - `xmake show -l tasks` does not exist
 * in 2.9.x ("unknown list name"), and `xmake --help` does not list custom tasks at
 * all. Per-task `<task> --help` does work (rc 0 vs rc 255 "invalid task") but costs a
 * process per task.
 */
export function extractTaskNames(
  source: string,
): { name: string; description: string; acceptsTarget: boolean }[] {
  TASK_RE.lastIndex = 0;

  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = TASK_RE.exec(source)) !== null) {
    matches.push(match);
  }

  return matches.map((current, index) => {
    // The block runs to the NEXT top-level task. An unbounded search would attach
    // the following task's description when this one declares no set_menu at all.
    const start = current.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const block = source.slice(start, end);

    const menuIndex = block.indexOf("set_menu");
    let description = "";
    if (menuIndex !== -1) {
      const desc = block.slice(menuIndex).match(DESCRIPTION_RE);
      if (desc) {
        description = desc[1];
      }
    }

    return {
      name: current[1],
      description,
      // Matched against this task's own block only, never the next task's options.
      acceptsTarget: TARGET_OPTION_RE.test(block),
    };
  });
}

/**
 * Discover the project's own tasks.
 *
 * Scans `.lua/tasks/*.lua` (where the extension and the project keep task files)
 * plus `xmake.lua`, which is still a legitimate home for a small task.
 *
 * Returns the shipped/reserved tasks filtered out, sorted by name, deduplicated
 * first-wins so a task redefined in two files appears once.
 */
export function scanCustomTasks(workspacePath: string): CustomTask[] {
  const sources: { path: string; file: string }[] = [];

  const tasksDir = join(workspacePath, CONFIG_DIR, "tasks");
  if (existsSync(tasksDir)) {
    for (const entry of readdirSync(tasksDir).sort()) {
      if (entry.toLowerCase().endsWith(".lua")) {
        sources.push({ path: join(tasksDir, entry), file: `${CONFIG_DIR}/tasks/${entry}` });
      }
    }
  }

  const xmakeLua = join(workspacePath, "xmake.lua");
  if (existsSync(xmakeLua)) {
    sources.push({ path: xmakeLua, file: "xmake.lua" });
  }

  const seen = new Set<string>();
  const tasks: CustomTask[] = [];

  for (const source of sources) {
    for (const { name, description, acceptsTarget } of extractTaskNames(readText(source.path))) {
      if (
        !TASK_NAME_RE.test(name) ||
        SHIPPED_TASKS.has(name) ||
        RESERVED_TASKS.has(name) ||
        seen.has(name)
      ) {
        continue;
      }
      seen.add(name);
      tasks.push({ name, description, file: source.file, acceptsTarget });
    }
  }

  return tasks.sort((a, b) => a.name.localeCompare(b.name));
}
