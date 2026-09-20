import * as vscode from "vscode";
import { buildXmakeCommand, getShellSeparator } from "./utils";
import { chooseTarget, readTargetFiles } from "./projectConfig";
import { logger } from "./logger";

/**
 * Task definition contributed by the xmake task provider.
 */
interface XmakeTaskDefinition extends vscode.TaskDefinition {
  command: string;
  mode?: string;
  /**
   * Build target stem. Optional: a `tasks.json` author may pin it, and the
   * extension's own commands pass the active target. When absent the first target
   * found on disk is used.
   */
  target?: string;
}

/**
 * One entry in the task catalog. `commands` are xmake argument strings (the
 * executable prefix is added when the shell line is built).
 */
interface TaskDescriptor {
  /** Stable task definition id (also what `resolveTask` matches on). */
  command: string;
  label: string;
  mode?: string;
  commands: (target: string) => string[];
}

const XMAKE_TYPE = "xmake";
const PROBLEM_MATCHER = "$xmake-gcc";

/**
 * Catalog exposed to the VS Code Task API.
 *
 * `command` must map to a real xmake invocation. Two entries were phantoms and are
 * replaced by their measured equivalents:
 *   "configure" -> xmake configure : error: invalid task: configure (rc 255)
 *   "rebuild"   -> xmake rebuild   : error: invalid task: rebuild   (rc 255)
 *
 * Every entry that acts on firmware is target-explicit. A bare `xmake` builds ALL
 * targets, and a bare `xmake flash` refuses to guess when several exist - leaving
 * the target out here would contradict the multi-target design and silently build
 * boards the user did not select.
 */
const TASK_DESCRIPTORS: readonly TaskDescriptor[] = [
  { command: "configure", label: "Configure", commands: () => ["f -y"] },
  {
    command: "build",
    label: "Build",
    mode: "debug",
    commands: (target) => ["f -m debug -y", `build -v ${target}`],
  },
  {
    // Same command id as the debug entry on purpose: `mode` distinguishes them. A new
    // id ("buildRelease") would break the {command:"build", mode:"release"} address
    // that v2.0.1 shipped and that a user's tasks.json may still pin.
    command: "build",
    label: "Build Release",
    mode: "release",
    commands: (target) => ["f -m release -y", `build -v ${target}`],
  },
  { command: "clean", label: "Clean", commands: (target) => [`clean ${target}`] },
  { command: "rebuild", label: "Rebuild", commands: (target) => [`-r -v ${target}`] },
  // flash.lua takes the target as an option, not a positional argument.
  { command: "flash", label: "Flash", commands: (target) => [`flash --target=${target}`] },
  { command: "docs", label: "Generate Docs", commands: () => ["docs"] },
];

/**
 * VS Code TaskProvider that exposes xmake build actions as runnable tasks.
 */
export class XmakeTaskProvider implements vscode.TaskProvider {
  /**
   * Supplies the user's currently selected target. Injected as a callback so this module
   * never imports XmakeManager - `extension.ts` owns both and wires them together, which
   * keeps the two classes acyclic.
   */
  constructor(
    private readonly activeTarget: () => string | undefined = () => undefined,
  ) {}

  async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as XmakeTaskDefinition;
    if (definition.command) {
      return this.createTask(
        definition.command,
        definition.mode,
        undefined,
        definition.target,
      );
    }
    return undefined;
  }

  private getTasks(): vscode.Task[] {
    // Deliberately NOT memoized. Every provided task bakes the active target into its
    // command line, so a cached catalog would keep advertising whichever target was
    // selected when VS Code first queried it. Seven entries are cheaper to rebuild than a
    // stale picker, and @types/vscode offers no onDidChangeTasks to invalidate with.
    const tasks = TASK_DESCRIPTORS.map((desc) =>
      this.createTask(desc.command, desc.mode, desc.label),
    ).filter((task): task is vscode.Task => task !== undefined);

    logger.debug(`Registered ${tasks.length} xmake tasks`);
    return tasks;
  }

  /**
   * Resolve which target a task acts on: an explicit one from the task definition,
   * otherwise the first target on disk (deterministic: readTargetFiles sorts), and
   * otherwise the single "firmware" target the template builds.
   */
  private resolveTarget(
    folder: vscode.WorkspaceFolder,
    explicit?: string,
  ): string {
    const stems = readTargetFiles(folder.uri.fsPath).map((target) => target.stem);
    return chooseTarget(stems, explicit, this.activeTarget());
  }

  /**
   * Resolve a catalog entry. An exact (command, mode) match wins; when the mode is
   * absent or unknown the first entry for that command is used, so a minimal
   * {command:"build"} keeps working ``and old {command:"build", mode:"release"} pins
   * keep resolving to the release entry.
   */
  private findDescriptor(command: string, mode?: string): TaskDescriptor | undefined {
    const candidates = TASK_DESCRIPTORS.filter((desc) => desc.command === command);
    if (candidates.length === 0) {
      return undefined;
    }
    if (mode !== undefined) {
      const exact = candidates.find((desc) => desc.mode === mode);
      if (exact) {
        return exact;
      }
    }
    return candidates[0];
  }

  /**
   * Build a single task from the catalog. Multiple xmake commands are joined with
   * the shell-appropriate separator by the caller contract of ShellExecution.
   */
  private createTask(
    command: string,
    mode?: string,
    label?: string,
    explicitTarget?: string,
  ): vscode.Task | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    const descriptor = this.findDescriptor(command, mode);
    if (!descriptor) {
      logger.warning(`No task descriptor for command '${command}'`);
      return undefined;
    }

    const target = this.resolveTarget(workspaceFolder, explicitTarget);

    const definition: XmakeTaskDefinition = {
      type: XMAKE_TYPE,
      command,
      mode,
      target: descriptor.command === "configure" || descriptor.command === "docs"
        ? undefined
        : target,
    };

    // Chained with the shell-appropriate separator: PowerShell 5.1 rejects "&&".
    const cmdLine = descriptor.commands(target)
      .map(buildXmakeCommand)
      .join(getShellSeparator());

    const execution = new vscode.ShellExecution(cmdLine, {
      cwd: workspaceFolder.uri.fsPath,
    });

    const task = new vscode.Task(
      definition,
      workspaceFolder,
      label ?? `Xmake ${descriptor.label}`,
      XMAKE_TYPE,
      execution,
      PROBLEM_MATCHER,
    );

    task.group =
      descriptor.command === "build" ? vscode.TaskGroup.Build : undefined;

    return task;
  }
}
