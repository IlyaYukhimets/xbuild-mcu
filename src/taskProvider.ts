import * as vscode from "vscode";
import { buildXmakeCommand } from "./utils";
import { logger } from "./logger";

/**
 * Task definition contributed by the xmake task provider.
 */
interface XmakeTaskDefinition extends vscode.TaskDefinition {
  command: string;
  mode?: string;
}

/**
 * Static task catalog exposed by the provider.
 */
interface TaskDescriptor {
  command: string;
  label: string;
  mode?: string;
}

const XMAKE_TYPE = "xmake";
const PROBLEM_MATCHER = "$xmake-gcc";

const TASK_DESCRIPTORS: readonly TaskDescriptor[] = [
  { command: "configure", label: "Configure" },
  { command: "build", label: "Build", mode: "debug" },
  { command: "build", label: "Build Release", mode: "release" },
  { command: "clean", label: "Clean" },
  { command: "rebuild", label: "Rebuild" },
  { command: "flash", label: "Flash" },
  { command: "docs", label: "Generate Docs" },
];

/**
 * VS Code TaskProvider that exposes xmake build actions as runnable tasks.
 */
export class XmakeTaskProvider implements vscode.TaskProvider {
  private tasks: vscode.Task[] | undefined;

  async provideTasks(): Promise<vscode.Task[]> {
    return this.getTasks();
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as XmakeTaskDefinition;
    if (definition.command) {
      return this.createTask(definition.command, definition.mode);
    }
    return undefined;
  }

  private getTasks(): vscode.Task[] {
    if (this.tasks !== undefined) {
      return this.tasks;
    }

    this.tasks = TASK_DESCRIPTORS.map((desc) =>
      this.createTask(desc.command, desc.mode, desc.label),
    ).filter((task): task is vscode.Task => task !== undefined);

    logger.debug(`Registered ${this.tasks.length} xmake tasks`);
    return this.tasks;
  }

  /**
   * Build a single task. Build tasks run a configure step followed by the
   * build itself, mirroring XmakeManager.build().
   */
  private createTask(
    command: string,
    mode?: string,
    label?: string,
  ): vscode.Task | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    const definition: XmakeTaskDefinition = {
      type: XMAKE_TYPE,
      command,
      mode,
    };

    const taskLabel = label ?? `Xmake ${command}`;
    const cmdLine =
      command === "build" && mode
        ? `${buildXmakeCommand(`f -m ${mode} -y`)} && ${buildXmakeCommand("")}`
        : buildXmakeCommand(command);

    const execution = new vscode.ShellExecution(cmdLine, {
      cwd: workspaceFolder.uri.fsPath,
    });

    const task = new vscode.Task(
      definition,
      workspaceFolder,
      taskLabel,
      XMAKE_TYPE,
      execution,
      PROBLEM_MATCHER,
    );

    task.group = command === "build" ? vscode.TaskGroup.Build : undefined;
    return task;
  }
}
