import * as vscode from "vscode";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { LogLevel, logger } from "./logger";
import { showMemoryReport } from "./memoryAnalyzer";
import {
  buildXmakeCommand,
  getErrorMessage,
  getShellSeparator,
  getWorkspaceConfig,
  getWorkspacePath,
} from "./utils";
import {
  readProjectConfig,
  readTargetFiles,
  CONFIG_DIR,
  DEFAULT_TARGET_STEM,
  getProjectConfigPath,
  getTargetsDir,
  TASK_FILES,
} from "./projectConfig";
import { XmakeTemplate } from "./xmakeTemplate";

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
 * Central manager for Xmake operations.
 */
/** Key under which the active target is persisted in the workspace state. */
const ACTIVE_TARGET_KEY = "xmake.activeTarget";

export class XmakeManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private currentMode: BuildMode;
  private currentTarget: string;
  private buildStatus: BuildStatus = "idle";
  private currentTask: vscode.TaskExecution | undefined;
  private taskListener: vscode.Disposable | undefined;

  private readonly _onDidChangeMode = new vscode.EventEmitter<BuildMode>();
  public readonly didChangeMode = this._onDidChangeMode.event;

  private readonly _onDidChangeTarget = new vscode.EventEmitter<string>();
  public readonly didChangeTarget = this._onDidChangeTarget.event;

  private readonly _onDidChangeStatus =
    new vscode.EventEmitter<BuildStatusChangeEvent>();
  public readonly didChangeStatus = this._onDidChangeStatus.event;

  constructor(private readonly context?: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel("Xmake Build");
    this.currentMode = getWorkspaceConfig<BuildMode>("defaultMode", "debug");

    // The active target is per-user/per-workspace UI state, so it lives in the
    // workspace state - NOT in .lua/config.json, which is committed and shared.
    this.currentTarget =
      this.context?.workspaceState.get<string>(ACTIVE_TARGET_KEY) ??
      DEFAULT_TARGET_STEM;

    const verbose = getWorkspaceConfig<boolean>("verboseLogging", false);
    logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);

    this.taskListener = vscode.tasks.onDidEndTaskProcess((e) =>
      this.onTaskEnd(e),
    );

    logger.info("XmakeManager initialized", {
      mode: this.currentMode,
      target: this.currentTarget,
    });
  }

  public getMode(): BuildMode {
    return this.currentMode;
  }

  /** Active target id (the target JSON's file-name stem). */
  public getTarget(): string {
    return this.currentTarget;
  }

  /**
   * Target ids available in this workspace: the .lua/targets/*.json file stems.
   * Falls back to the single id the template builds when no target files exist,
   * so a single-image project still has exactly one selectable entry.
   */
  public getTargetList(): string[] {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      return [DEFAULT_TARGET_STEM];
    }
    const stems = readTargetFiles(workspacePath).map((t) => t.stem);
    return stems.length > 0 ? stems : [DEFAULT_TARGET_STEM];
  }

  /**
   * Keep the active target valid after the target files change on disk: a stem
   * that no longer exists would otherwise be handed to xmake, which answers with
   * an "invalid target" error.
   */
  public syncTarget(): void {
    const list = this.getTargetList();
    if (!list.includes(this.currentTarget)) {
      this.currentTarget = list[0];
      void this.context?.workspaceState.update(ACTIVE_TARGET_KEY, this.currentTarget);
      this._onDidChangeTarget.fire(this.currentTarget);
    }
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
   * Whether `xmake.lua` exists in the workspace (regardless of the other
   * project files). Used to pick the tree-view entry label.
   */
  public hasXmakeFile(): boolean {
    const workspacePath = this.getWorkspacePath();
    return !!workspacePath && existsSync(join(workspacePath, "xmake.lua"));
  }

  /**
   * Whether the project is fully initialized: `xmake.lua` AND
   * `.lua/config.json` AND all `.lua/tasks/*.lua` are present. Used by the
   * tree view to decide between build actions and the "Initialize Project"
   * / "Restore missing project files" entry.
   */
  public isProjectComplete(): boolean {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath || !existsSync(join(workspacePath, "xmake.lua"))) {
      return false;
    }
    if (!existsSync(getProjectConfigPath(workspacePath))) {
      return false;
    }
    const tasksDir = join(workspacePath, CONFIG_DIR, "tasks");
    return TASK_FILES.every((f) => existsSync(join(tasksDir, f)));
  }

  /**
   * Bootstrap a new project: create xmake.lua, .lua/config.json and
   * .lua/tasks/*.lua via the bundled template.
   */
  public async initProject(): Promise<boolean> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      vscode.window.showErrorMessage("No workspace folder open");
      return false;
    }

    const created = await XmakeTemplate.createProjectFiles(workspacePath);
    if (created) {
      // Notify listeners so tree views re-evaluate their state.
      this._onDidChangeMode.fire(this.currentMode);
    }
    return created;
  }

  /**
   * Build the project.
   */
  public async build(mode?: BuildMode): Promise<void> {
    const buildMode = mode ?? this.currentMode;
    const target = this.currentTarget;
    this.setBuildStatus("building");
    this.log(`Building ${target} in ${buildMode} mode...`);

    const task = this.createTask({
      commands: [
        buildXmakeCommand(`f -m ${buildMode} -y`),
        // `build -v <stem>`: the options must precede the positional target, a
        // trailing -v makes xmake print its usage screen instead of building.
        buildXmakeCommand(`build -v ${target}`),
      ],
      label: `Xmake Build (${target}, ${buildMode})`,
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
      commands: [buildXmakeCommand(`clean ${this.currentTarget}`)],
      label: `Xmake Clean (${this.currentTarget})`,
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
        buildXmakeCommand(`clean ${this.currentTarget}`),
        buildXmakeCommand(`f -m ${this.currentMode} -y`),
        buildXmakeCommand(`-r -v ${this.currentTarget}`),
      ],
      label: `Xmake Rebuild (${this.currentTarget})`,
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
    const workspacePath = this.getWorkspacePath();
    const jlinkPath = workspacePath
      ? readProjectConfig(workspacePath).jlink_path
      : "";
    const flashSpeed = getWorkspaceConfig<number>("flashSpeed", 4000);

    if (jlinkPath && isAbsolute(jlinkPath) && !existsSync(jlinkPath)) {
      const result = await vscode.window.showWarningMessage(
        `JLink not found at: ${jlinkPath}`,
        "Open Config",
        "Continue Anyway",
      );
      if (result === "Open Config") {
        vscode.commands.executeCommand("xmake.openConfig");
        return;
      }
      if (result !== "Continue Anyway") {
        return;
      }
    }

    this.log(`Flashing via JLink at ${flashSpeed} kHz...`);

    const task = this.createTask({
      // flash.lua is target-aware: it resolves the target from --target and
      // reports an error rather than guessing when several targets exist.
      commands: [
        buildXmakeCommand(`flash --target=${this.currentTarget} --speed=${flashSpeed}`),
      ],
      label: `Xmake Flash (${this.currentTarget})`,
      commandId: "flash",
    });
    await this.executeTask(task);
  }

  /**
   * Run a project-authored task: `xmake <name>`.
   *
   * Deliberately not routed through the build-status machinery (and therefore not
   * triggering the memory report): a project task is not a firmware build, so
   * reporting its exit code as "Build OK/Failed" would be misleading.
   */
  public async runTask(taskName: string, target?: string): Promise<void> {
    // Defence in depth: the scanner filters these already, but the name can also
    // arrive as a command argument (palette, keybinding, another extension).
    if (!/^[A-Za-z0-9_.-]+$/.test(taskName)) {
      vscode.window.showErrorMessage(`Refusing to run an unsafe task name: ${taskName}`);
      return;
    }

    // `target` is passed only by callers that know the task declares the option.
    // xmake rejects unknown options, so an unconditional --target= would break every
    // task that does not accept one.
    const args = target
      ? `${taskName} --target=${target}`
      : taskName;

    this.log(`Running project task: ${args}`);

    const task = this.createTask({
      commands: [buildXmakeCommand(args)],
      label: `Xmake ${taskName}`,
      commandId: "runTask",
    });
    await this.executeTask(task);
  }

  /**
   * Filenames the memory report should prefer: the active target's artifact in any
   * build mode. `firmware.elf` is included because that is what the template builds
   * when a project has no target files.
   */
  private expectedElfNames(): string[] {
    const workspacePath = this.getWorkspacePath();
    const names = new Set<string>([
      `${this.currentTarget}.elf`,
      `${DEFAULT_TARGET_STEM}.elf`,
    ]);

    if (workspacePath) {
      const current = readTargetFiles(workspacePath).find(
        (target) => target.stem === this.currentTarget,
      );
      if (current) {
        // The artifact may carry the JSON "name" rather than the file stem.
        names.add(`${current.name}.elf`);
      }
    }

    return [...names];
  }

  /**
   * Scaffold a new target: writes `.lua/targets/<name>.json` seeded from the shared
   * project settings. Deliberately a separate command rather than something init
   * does: a single-image project stays exactly as it was, and the file-system
   * watcher picks the new target up without a reload.
   */
  public async addTarget(): Promise<void> {
    const workspacePath = this.getWorkspacePath();
    if (!workspacePath) {
      vscode.window.showErrorMessage("No workspace folder open");
      return;
    }

    const existing = this.getTargetList();
    const name = await vscode.window.showInputBox({
      prompt: "Name of the new build target (the file .lua/targets/<name>.json)",
      placeHolder: "bootloader",
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return "A name is required";
        }
        if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
          return "Use letters, digits, dot, dash or underscore only";
        }
        if (existing.includes(trimmed)) {
          return `Target '${trimmed}' already exists`;
        }
        return null;
      },
    });

    if (!name) {
      return;
    }

    const stem = name.trim();
    const config = readProjectConfig(workspacePath);
    const path = join(getTargetsDir(workspacePath), `${stem}.json`);

    if (existsSync(path)) {
      vscode.window.showWarningMessage(`${stem}.json already exists`);
      return;
    }

    // The artifact name follows the project name so several targets do not all
    // produce the same .elf, which would make them indistinguishable in build/.
    const artifact = config.name ? `${config.name}-${stem}` : stem;

    try {
      mkdirSync(getTargetsDir(workspacePath), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ name: artifact, defines: [], sources: [], includedirs: [] }, null, 4) + "\n",
        "utf-8",
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to create ${stem}.json: ${getErrorMessage(error)}`,
      );
      return;
    }

    this.syncTarget();
    this._onDidChangeTarget.fire(this.currentTarget);
    this.log(`Created target ${stem} (${artifact})`);
    vscode.window.showInformationMessage(`Target created: ${stem}`);
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

  /**
   * Quick-pick for the active build target. Mirrors setMode().
   */
  public async setTarget(): Promise<void> {
    const targets = this.getTargetList();
    const selected = await vscode.window.showQuickPick(targets, {
      placeHolder: `Current target: ${this.currentTarget}`,
    });

    if (!selected) {
      return;
    }

    this.currentTarget = selected;
    await this.context?.workspaceState.update(ACTIVE_TARGET_KEY, selected);
    this._onDidChangeTarget.fire(selected);
    this.log(`Build target set to: ${selected}`);
    vscode.window.showInformationMessage(`Xmake build target: ${selected}`);
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
    this._onDidChangeTarget.dispose();
    this._onDidChangeStatus.dispose();
  }

  /**
   * Create a VS Code task that runs one or more xmake shell commands.
   * Multiple commands are joined using the shell-appropriate separator.
   */
  private createTask(options: TaskOptions): vscode.Task {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspacePath = workspaceFolder?.uri.fsPath ?? "";
    const separator = getShellSeparator();
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
          void showMemoryReport(workspacePath, this.expectedElfNames());
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
