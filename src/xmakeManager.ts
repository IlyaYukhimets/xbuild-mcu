import * as vscode from "vscode";
import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { LogLevel, logger } from "./logger";
import { showMemoryReport } from "./memoryAnalyzer";
import {
  buildXmakeCommand,
  getWorkspaceConfig,
  getWorkspacePath,
} from "./utils";

/**
 * Build status type
 */
export type BuildStatus = "idle" | "building" | "success" | "error";

/**
 * Build mode type
 */
export type BuildMode = "debug" | "release";

/**
 * Event emitted when build status changes
 */
export interface BuildStatusChangeEvent {
  status: BuildStatus;
  mode: BuildMode;
  error?: string;
}

/**
 * Task creation options
 */
interface TaskOptions {
  /** Shell command line(s) to execute. Multiple entries are joined with the shell separator. */
  commands: string[];
  label: string;
  /** Stable identifier stored on the task definition. */
  commandId: string;
  group?: vscode.TaskGroup;
  clearOutput?: boolean;
}

const PROBLEM_MATCHER = "$xmake-gcc";

/**
 * Detect whether the active shell is PowerShell. PowerShell uses `;` as
 * the command separator while cmd/bash use `&&`.
 */
function isPowerShell(): boolean {
  const shellEnv = process.env.SHELL ?? "";
  if (/powershell|pwsh/i.test(shellEnv)) {
    return true;
  }

  if (process.platform === "win32") {
    if (process.env.PSModulePath) {
      return true;
    }
    const comSpec = process.env.ComSpec ?? "";
    if (/powershell|pwsh/i.test(comSpec)) {
      return true;
    }
  }

  return false;
}

/**
 * Central manager for Xmake operations.
 */
export class XmakeManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private currentMode: BuildMode;
  private buildStatus: BuildStatus = "idle";
  private currentTask: vscode.TaskExecution | undefined;
  private taskListener: vscode.Disposable | undefined;

  private readonly _onDidChangeMode = new vscode.EventEmitter<BuildMode>();
  public readonly didChangeMode = this._onDidChangeMode.event;

  private readonly _onDidChangeStatus =
    new vscode.EventEmitter<BuildStatusChangeEvent>();
  public readonly didChangeStatus = this._onDidChangeStatus.event;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Xmake Build");
    this.currentMode = getWorkspaceConfig<BuildMode>("defaultMode", "debug");

    const verbose = getWorkspaceConfig<boolean>("verboseLogging", false);
    logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);

    this.taskListener = vscode.tasks.onDidEndTaskProcess((e) =>
      this.onTaskEnd(e),
    );

    logger.info("XmakeManager initialized", { mode: this.currentMode });
  }

  public getMode(): BuildMode {
    return this.currentMode;
  }

  public getStatus(): BuildStatus {
    return this.buildStatus;
  }

  public getWorkspacePath(): string | undefined {
    return getWorkspacePath();
  }

  /**
   * Reset build status to idle (used by the status bar auto-reset).
   */
  public resetBuildStatus(): void {
    this.buildStatus = "idle";
  }

  /**
   * Check if xmake.lua exists in the workspace.
   */
  public async checkProject(): Promise<boolean> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      logger.warning("No workspace folder open");
      return false;
    }

    if (!existsSync(join(workspacePath, "xmake.lua"))) {
      this.log("xmake.lua not found in workspace");
      return false;
    }

    this.log("Found xmake.lua project");
    return true;
  }

  /**
   * Build the project.
   */
  public async build(mode?: BuildMode): Promise<void> {
    const buildMode = mode ?? this.currentMode;
    this.setBuildStatus("building");
    this.log(`Building in ${buildMode} mode...`);

    const task = this.createTask({
      commands: [
        buildXmakeCommand(`f -m ${buildMode} -y`),
        buildXmakeCommand("-v"),
      ],
      label: `Xmake Build (${buildMode})`,
      commandId: "build",
      group: vscode.TaskGroup.Build,
    });

    await this.executeTask(task);
  }

  /**
   * Clean build artifacts.
   */
  public async clean(): Promise<void> {
    this.log("Cleaning project...");
    this.setBuildStatus("idle");

    const task = this.createTask({
      commands: [buildXmakeCommand("clean")],
      label: "Xmake Clean",
      commandId: "clean",
    });
    await this.executeTask(task);
  }

  /**
   * Rebuild the project from scratch.
   */
  public async rebuild(): Promise<void> {
    this.setBuildStatus("building");
    this.log("Rebuilding project...");

    const task = this.createTask({
      commands: [
        buildXmakeCommand("f -c"),
        buildXmakeCommand("clean"),
        buildXmakeCommand(`f -m ${this.currentMode} -y`),
        buildXmakeCommand("-r -v"),
      ],
      label: "Xmake Rebuild",
      commandId: "rebuild",
      group: vscode.TaskGroup.Build,
      clearOutput: true,
    });

    await this.executeTask(task);
  }

  /**
   * Flash firmware via JLink.
   */
  public async flash(): Promise<void> {
    const jlinkPath = getWorkspaceConfig<string>("jlinkPath", "JLink.exe");
    const flashSpeed = getWorkspaceConfig<number>("flashSpeed", 4000);

    if (isAbsolute(jlinkPath) && !existsSync(jlinkPath)) {
      const result = await vscode.window.showWarningMessage(
        `JLink not found at: ${jlinkPath}`,
        "Open Settings",
        "Continue Anyway",
      );
      if (result === "Open Settings") {
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "xmake.jlinkPath",
        );
        return;
      }
      if (result !== "Continue Anyway") {
        return;
      }
    }

    this.log(`Flashing via JLink at ${flashSpeed} kHz...`);

    const task = this.createTask({
      commands: [buildXmakeCommand("flash")],
      label: "Xmake Flash",
      commandId: "flash",
    });
    await this.executeTask(task);
  }

  /**
   * Generate Doxygen documentation.
   */
  public async docs(): Promise<void> {
    this.log("Generating Doxygen documentation...");

    const task = this.createTask({
      commands: [buildXmakeCommand("docs")],
      label: "Xmake Docs",
      commandId: "docs",
    });
    await this.executeTask(task);
  }

  /**
   * Import project from CubeMX.
   */
  public async cubemx(): Promise<void> {
    const cubemxPath = await vscode.window.showInputBox({
      prompt: "Enter path to CubeMX project",
      placeHolder: "C:/Projects/MyCubeMXProject",
      validateInput: (value) => {
        if (!value) {
          return "Path is required";
        }
        if (!existsSync(value)) {
          return "Path does not exist";
        }
        return null;
      },
    });

    if (!cubemxPath) {
      return;
    }

    this.log(`Importing from CubeMX: ${cubemxPath}`);

    const task = this.createTask({
      commands: [buildXmakeCommand(`cubemx --path="${cubemxPath}"`)],
      label: "Xmake CubeMX Import",
      commandId: "cubemx",
    });
    await this.executeTask(task);
  }

  /**
   * Apply a template from the configured templates folder.
   */
  public async template(): Promise<void> {
    const templatesPath = getWorkspaceConfig<string>(
      "templatesPath",
      "templates",
    );
    const workspacePath = this.getWorkspacePath();

    if (!workspacePath) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const fullTemplatesPath = join(workspacePath, templatesPath);

    if (!existsSync(fullTemplatesPath)) {
      const result = await vscode.window.showWarningMessage(
        `Templates folder not found: ${templatesPath}`,
        "Add as Submodule",
        "Cancel",
      );
      if (result === "Add as Submodule") {
        const submoduleUrl = await vscode.window.showInputBox({
          prompt: "Enter templates repository URL",
          placeHolder: "git@your-server.com:templates.git",
        });
        if (submoduleUrl) {
          const terminal = vscode.window.createTerminal("Git");
          terminal.show();
          terminal.sendText(
            `git submodule add ${submoduleUrl} ${templatesPath}`,
          );
        }
      }
      return;
    }

    const templates = readdirSync(fullTemplatesPath).filter((f) =>
      statSync(join(fullTemplatesPath, f)).isDirectory(),
    );

    if (templates.length === 0) {
      vscode.window.showWarningMessage(
        "No templates found in " + templatesPath,
      );
      return;
    }

    const selected = await vscode.window.showQuickPick(templates, {
      placeHolder: "Select a template to apply",
    });

    if (!selected) {
      return;
    }

    this.log(`Applying template: ${selected}`);

    const task = this.createTask({
      commands: [buildXmakeCommand(`template --mcu=${selected}`)],
      label: "Xmake Template",
      commandId: "template",
    });
    await this.executeTask(task);
  }

  /**
   * List available templates.
   */
  public async templateList(): Promise<void> {
    this.log("Listing available templates...");

    const task = this.createTask({
      commands: [buildXmakeCommand("template --list")],
      label: "Xmake Template List",
      commandId: "templateList",
    });
    await this.executeTask(task);
  }

  /**
   * Show a quick-pick UI to select the build mode.
   */
  public async setMode(): Promise<void> {
    const items: BuildMode[] = ["debug", "release"];
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Current mode: ${this.currentMode}`,
    });

    if (selected === "debug" || selected === "release") {
      this.currentMode = selected;
      this._onDidChangeMode.fire(selected);
      this.log(`Build mode set to: ${selected}`);
      vscode.window.showInformationMessage(`Xmake build mode: ${selected}`);
    }
  }

  public showOutput(): void {
    this.outputChannel.show();
  }

  public showLog(): void {
    logger.show();
  }

  /**
   * Cancel the currently running build task.
   */
  public cancelBuild(): void {
    if (this.currentTask) {
      this.currentTask.terminate();
      this.currentTask = undefined;
      this.setBuildStatus("idle");
      this.log("Build cancelled");
    }
  }

  public dispose(): void {
    this.currentTask?.terminate();
    this.currentTask = undefined;
    this.taskListener?.dispose();
    this.taskListener = undefined;
    this.outputChannel.dispose();
    this._onDidChangeMode.dispose();
    this._onDidChangeStatus.dispose();
  }

  /**
   * Create a VS Code task that runs one or more xmake shell commands.
   * Multiple commands are joined using the shell-appropriate separator.
   */
  private createTask(options: TaskOptions): vscode.Task {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspacePath = workspaceFolder?.uri.fsPath ?? "";
    const separator = isPowerShell() ? "; " : " && ";
    const cmdLine = options.commands.join(separator);

    const definition = { type: "xmake", command: options.commandId };
    const execution = new vscode.ShellExecution(cmdLine, {
      cwd: workspacePath,
    });

    const task = new vscode.Task(
      definition,
      workspaceFolder ?? vscode.TaskScope.Workspace,
      options.label,
      "xmake",
      execution,
      PROBLEM_MATCHER,
    );

    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Shared,
      clear:
        options.clearOutput ??
        getWorkspaceConfig<boolean>("clearOutputBeforeBuild", true),
    };
    task.group = options.group;

    return task;
  }

  /**
   * Execute a task, cancelling any currently running task first.
   */
  private async executeTask(task: vscode.Task): Promise<vscode.TaskExecution> {
    if (this.currentTask) {
      this.currentTask.terminate();
      this.currentTask = undefined;
    }

    const execution = await vscode.tasks.executeTask(task);
    this.currentTask = execution;
    return execution;
  }

  /**
   * Handle task completion: update build status and report memory usage.
   */
  private onTaskEnd(e: vscode.TaskProcessEndEvent): void {
    const task = e.execution.task;
    const definition = task.definition as { type?: string; command?: string };

    if (definition.type !== "xmake" && !task.name.includes("Xmake")) {
      return;
    }

    logger.debug("Task ended", {
      name: task.name,
      exitCode: e.exitCode,
      command: definition.command,
    });

    if (this.buildStatus === "building") {
      if (e.exitCode === 0) {
        this.setBuildStatus("success");
        vscode.window.showInformationMessage(
          `Build completed successfully (${this.currentMode})`,
        );
        const workspacePath = this.getWorkspacePath();
        if (workspacePath) {
          void showMemoryReport(workspacePath);
        }
      } else if (e.exitCode !== undefined) {
        this.setBuildStatus("error", `Exit code: ${e.exitCode}`);
        vscode.window.showErrorMessage(
          `Build failed with exit code ${e.exitCode}. Check output for details.`,
        );
      }
    }

    this.currentTask = undefined;
  }

  private setBuildStatus(status: BuildStatus, error?: string): void {
    this.buildStatus = status;

    this._onDidChangeStatus.fire({
      status,
      mode: this.currentMode,
      error,
    });

    logger.debug("Build status changed", {
      status,
      mode: this.currentMode,
      error,
    });
  }

  /**
   * Write a timestamped line to the build output channel and mirror it
   * to the diagnostic logger at debug level.
   */
  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    logger.debug(message);
  }
}
