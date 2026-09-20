import * as vscode from "vscode";
import { XmakeManager } from "./xmakeManager";
import { XmakeStatusBar } from "./statusBar";
import { XmakeTaskProvider } from "./taskProvider";
import { XmakeMainViewProvider, XmakeActionsViewProvider } from "./treeView";
import { XmakeConfigPanel } from "./xmakeConfigPanel";
import { scanCustomTasks } from "./taskScanner";
import { Logger, LogLevel, logger } from "./logger";

/**
 * Command definition: id plus a handler bound to the extension state.
 */
interface CommandDefinition {
  id: string;
  /**
   * Command handlers receive whatever the invoker passes - a tree item passes the
   * task name as an argument. `unknown[]` keeps this assignable from both the
   * zero-argument handlers and the one taking an argument, under strict function types.
   */
  handler: (...args: unknown[]) => void;
}

/**
 * Global extension state.
 * Populated during `activate`, cleared in `deactivate`.
 */
interface ExtensionState {
  xmakeManager: XmakeManager;
  statusBar: XmakeStatusBar;
  taskProvider: vscode.Disposable;
  mainViewProvider: XmakeMainViewProvider;
  actionsViewProvider: XmakeActionsViewProvider;
  workspacePath: string | undefined;
  extensionUri: vscode.Uri;
}

let state: ExtensionState | undefined;
let isActivated = false;

/**
 * Build the list of commands exposed by the extension. Each handler is
 * a closure over the current `state`.
 */
function createCommandDefinitions(): CommandDefinition[] {
  if (!state) {
    return [];
  }

  const manager = state.xmakeManager;
  const refreshMain = () => state?.mainViewProvider.refresh();
  const refreshActions = () => state?.actionsViewProvider.refresh();

  return [
    {
      id: "xmake.init",
      handler: () =>
        void manager.initProject().then((ok) => {
          if (ok) {
            state?.mainViewProvider.refresh();
          }
        }),
    },
    {
      id: "xmake.openConfig",
      handler: () => {
        if (state?.workspacePath) {
          XmakeConfigPanel.createOrShow(
            state.extensionUri,
            state.workspacePath,
          );
        } else {
          vscode.window.showErrorMessage("No workspace folder open");
        }
      },
    },
    {
      id: "xmake.build",
      handler: () => void manager.build().then(refreshMain),
    },
    {
      id: "xmake.buildDebug",
      handler: () => void manager.build("debug").then(refreshMain),
    },
    {
      id: "xmake.buildRelease",
      handler: () => void manager.build("release").then(refreshMain),
    },
    { id: "xmake.clean", handler: () => void manager.clean() },
    { id: "xmake.rebuild", handler: () => void manager.rebuild() },
    { id: "xmake.flash", handler: () => void manager.flash() },
    { id: "xmake.docs", handler: () => void manager.docs() },
    { id: "xmake.cubemx", handler: () => void manager.cubemx() },
    { id: "xmake.template", handler: () => void manager.template() },
    { id: "xmake.templateList", handler: () => void manager.templateList() },
    {
      id: "xmake.setMode",
      handler: () =>
        void manager.setMode().then(() => {
          state?.mainViewProvider.refresh();
        }),
    },
    {
      id: "xmake.setTarget",
      handler: () =>
        void manager.setTarget().then(() => {
          // Both views: Project Tasks are rendered into the Actions view and bake
          // --target into their command at render time, so a target switch must
          // refresh them or the buttons would carry the previous stem.
          state?.mainViewProvider.refresh();
          state?.actionsViewProvider.refresh();
        }),
    },
    {
      id: "xmake.addTarget",
      handler: () => void manager.addTarget().then(refreshActions),
    },
    {
      id: "xmake.runTask",
      handler: (taskNameArg?: unknown, targetArg?: unknown) => {
        const taskName = typeof taskNameArg === "string" ? taskNameArg : undefined;
        const target = typeof targetArg === "string" ? targetArg : undefined;

        if (taskName) {
          void manager.runTask(taskName, target).then(refreshActions);
          return;
        }

        // Invoked from the palette without arguments: offer what is on disk and work
        // out the target flag from the task's own declaration.
        const workspacePath = state?.workspacePath;
        const tasks = workspacePath ? scanCustomTasks(workspacePath) : [];
        if (tasks.length === 0) {
          vscode.window.showInformationMessage(
            'No project tasks found in .lua/tasks/. Define one with task("name") there.',
          );
          return;
        }

        void vscode.window
          .showQuickPick(
            tasks.map((task) => ({
              label: task.name,
              description: task.description,
              detail: task.file,
            })),
            { placeHolder: "Select a project task to run" },
          )
          .then((selected) => {
            if (selected) {
              const chosen = tasks.find((task) => task.name === selected.label);
              void manager
                .runTask(
                  selected.label,
                  chosen?.acceptsTarget ? manager.getTarget() : undefined,
                )
                .then(refreshActions);
            }
          });
      },
    },
    { id: "xmake.showOutput", handler: () => manager.showOutput() },
    { id: "xmake.showLog", handler: () => manager.showLog() },
    {
      id: "xmake.cancelBuild",
      handler: () => {
        manager.cancelBuild();
        vscode.window.showInformationMessage("Build cancelled");
      },
    },
  ];
}

/**
 * Apply the current `verboseLogging` setting to the logger.
 */
function syncLogLevel(): void {
  const verbose = vscode.workspace
    .getConfiguration("xmake")
    .get<boolean>("verboseLogging", false);
  logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);
}

/**
 * Instantiate all extension components into `state`.
 */
function initializeComponents(context: vscode.ExtensionContext): void {
  if (!state) {
    return;
  }

  state.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  state.extensionUri = context.extensionUri;

  syncLogLevel();

  state.xmakeManager = new XmakeManager(context);
  // The persisted target may point at a target file that has since disappeared.
  state.xmakeManager.syncTarget();
  state.statusBar = new XmakeStatusBar(state.xmakeManager);
  state.taskProvider = vscode.tasks.registerTaskProvider(
    "xmake",
    // tasks.json entries resolved through the Task API must honour the selected target,
    // not the first one on disk. A getter keeps the value live and the modules acyclic.
    new XmakeTaskProvider(() => state?.xmakeManager.getTarget()),
  );
  state.mainViewProvider = new XmakeMainViewProvider(state.xmakeManager);
  state.actionsViewProvider = new XmakeActionsViewProvider(state.xmakeManager);

  logger.info("Extension components initialized");
}

export function activate(context: vscode.ExtensionContext): void {
  if (isActivated) {
    logger.warning("Extension already activated");
    return;
  }

  logger.info("Xmake Tools extension is activating...");

  if (!vscode.workspace.isTrusted) {
    logger.warning("Workspace is not trusted. Extension will not activate.");
    vscode.window.showWarningMessage(
      "Xmake Tools requires a trusted workspace to run build commands. " +
        "Please trust this workspace to use the extension.",
    );
    return;
  }

  state = {} as ExtensionState;
  initializeComponents(context);

  const commands = createCommandDefinitions().map((def) =>
    vscode.commands.registerCommand(def.id, def.handler),
  );

  const treeViews = [
    vscode.window.registerTreeDataProvider(
      "xmake.mainView",
      state.mainViewProvider,
    ),
    vscode.window.registerTreeDataProvider(
      "xmake.actionsView",
      state.actionsViewProvider,
    ),
  ];

  // Task files and the build script define both the custom-task list and the target
  // list, so a change on disk must re-evaluate the views. Without this, a newly added
  // .lua/tasks/audit.lua or .lua/targets/board.json only appears after a reload.
  const watchedFiles = [
    vscode.workspace.createFileSystemWatcher("**/.lua/tasks/*.lua"),
    vscode.workspace.createFileSystemWatcher("**/.lua/targets/*.json"),
    vscode.workspace.createFileSystemWatcher("**/xmake.lua"),
  ];
  for (const watcher of watchedFiles) {
    // activate() scope: refreshActions()/refreshMain() are locals of
    // createCommandDefinitions(), so the providers are addressed directly here -
    // exactly like the sibling didChangeMode listener below.
    const onDiskChange = () => {
      state?.xmakeManager.syncTarget();
      state?.actionsViewProvider.refresh();
      state?.mainViewProvider.refresh();
    };
    watcher.onDidCreate(onDiskChange);
    watcher.onDidDelete(onDiskChange);
    // Editing a target file or a task changes what the views show too.
    watcher.onDidChange(onDiskChange);
  }

  const eventListeners: vscode.Disposable[] = [
    // Spread first so the watchers are disposed with the rest of the subscriptions.
    ...watchedFiles,
    state.xmakeManager.didChangeMode(() => state?.mainViewProvider.refresh()),
    state.xmakeManager.didChangeTarget(() => {
      state?.mainViewProvider.refresh();
      state?.actionsViewProvider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("xmake")) {
        logger.debug("Configuration changed, updating settings");
        syncLogLevel();
      }
    }),
  ];

  context.subscriptions.push(
    ...commands,
    state.statusBar,
    state.taskProvider,
    state.xmakeManager,
    ...treeViews,
    ...eventListeners,
    { dispose: () => logger.dispose() },
  );

  if (state.workspacePath) {
    state.xmakeManager
      .checkProject()
      .then((found) => {
        if (!found) {
          logger.info("No xmake.lua found in workspace");
        }
      })
      .catch((error) => logger.error("Failed to check project", error));
  }

  isActivated = true;
  logger.info("Xmake Tools extension is now active");
}

export function deactivate(): void {
  if (!isActivated) {
    return;
  }

  logger.info("Xmake Tools extension is deactivating...");
  // All disposables are registered in context.subscriptions and disposed
  // automatically by VS Code. We only reset local state here.
  state = undefined;
  isActivated = false;
  logger.info("Xmake Tools extension deactivated");
}

// Re-exported types for external consumers / tests.
export { Logger } from "./logger";
