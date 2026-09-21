import * as vscode from "vscode";
import { XmakeManager } from "./xmakeManager";
import { scanCustomTasks } from "./taskScanner";
import { logger } from "./logger";

/**
 * Tree item for Xmake view
 */
export class XmakeTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly iconPath?: vscode.ThemeIcon | string,
    public readonly contextValue?: string,
    /** Nested items, for grouping nodes such as the project-task subcategory. */
    public readonly children?: XmakeTreeItem[],
  ) {
    super(label, collapsibleState);
    this.iconPath = iconPath;
    this.contextValue = contextValue;
  }
}

/**
 * Interface for tree item definition
 */
interface TreeItemDefinition {
  label: string;
  commandId: string;
  commandTitle: string;
  icon: string;
  contextValue?: string;
  dynamicLabel?: (manager: XmakeManager) => string;
}

/**
 * Base class for Xmake tree data providers
 * Implements common TreeDataProvider functionality
 */
abstract class BaseTreeDataProvider implements vscode.TreeDataProvider<XmakeTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    XmakeTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(protected xmakeManager: XmakeManager) {}

  refresh(): void {
    logger.debug(`Refreshing tree view: ${this.constructor.name}`);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: XmakeTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: XmakeTreeItem): Thenable<XmakeTreeItem[]> {
    if (!element) {
      return Promise.resolve(this.getItems());
    }
    // Grouping nodes (currently the project-task subcategory) carry their children.
    return Promise.resolve(element.children ?? []);
  }

  /**
   * Get the tree items for this provider
   * Must be implemented by derived classes
   */
  protected abstract getItems(): XmakeTreeItem[];

  /**
   * Helper method to create tree items from definitions
   */
  protected createItemsFromDefinitions(
    definitions: TreeItemDefinition[],
  ): XmakeTreeItem[] {
    return definitions.map((def) => {
      const label = def.dynamicLabel
        ? def.dynamicLabel(this.xmakeManager)
        : def.label;

      return new XmakeTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        { command: def.commandId, title: def.commandTitle },
        new vscode.ThemeIcon(def.icon),
        def.contextValue,
      );
    });
  }
}

/**
 * Main view tree items definitions
 */
const MAIN_VIEW_ITEMS: TreeItemDefinition[] = [
  {
    label: "Project Configuration",
    commandId: "xmake.openConfig",
    commandTitle: "Open Configuration",
    icon: "settings-gear",
  },
  {
    label: "Mode",
    commandId: "xmake.setMode",
    commandTitle: "Set Mode",
    icon: "symbol-misc",
    dynamicLabel: (manager) => `Mode: ${manager.getMode().toUpperCase()}`,
  },
  {
    label: "Target",
    commandId: "xmake.setTarget",
    commandTitle: "Select Target",
    icon: "target",
    dynamicLabel: (manager) => `Target: ${manager.getTarget()}`,
  },
  {
    // Discoverable entry point for the multi-target workflow: a project without
    // .lua/targets/ builds as a single "firmware" target, and this is how the user
    // starts defining more than one.
    label: "Add Target",
    commandId: "xmake.addTarget",
    commandTitle: "Add Build Target",
    icon: "add",
    contextValue: "addTargetAction",
  },
  {
    label: "Build",
    commandId: "xmake.build",
    commandTitle: "Build",
    icon: "play",
    contextValue: "buildAction",
  },
  {
    label: "Rebuild",
    commandId: "xmake.rebuild",
    commandTitle: "Rebuild",
    icon: "refresh",
  },
  {
    label: "Clean",
    commandId: "xmake.clean",
    commandTitle: "Clean",
    icon: "trash",
  },
];

/**
 * Actions view tree items definitions
 */
const ACTIONS_VIEW_ITEMS: TreeItemDefinition[] = [
  {
    label: "Flash (JLink)",
    commandId: "xmake.flash",
    commandTitle: "Flash",
    icon: "zap",
  },
  {
    label: "Generate Docs",
    commandId: "xmake.docs",
    commandTitle: "Docs",
    icon: "book",
  },
  {
    label: "Import CubeMX",
    commandId: "xmake.cubemx",
    commandTitle: "CubeMX",
    icon: "folder-opened",
  },
  {
    label: "Apply Template",
    commandId: "xmake.template",
    commandTitle: "Template",
    icon: "file-code",
  },
  {
    label: "List Templates",
    commandId: "xmake.templateList",
    commandTitle: "List Templates",
    icon: "list-unordered",
  },
];

/**
 * Main view provider for build actions.
 *
 * When the project is not yet initialized (no xmake.lua) it shows a single
 * "Initialize Project" entry instead of the build actions.
 */
export class XmakeMainViewProvider extends BaseTreeDataProvider {
  constructor(xmakeManager: XmakeManager) {
    super(xmakeManager);
  }

  protected getItems(): XmakeTreeItem[] {
    if (!this.xmakeManager.isProjectComplete()) {
      const fresh = !this.xmakeManager.hasXmakeFile();
      return [
        new XmakeTreeItem(
          fresh ? "Initialize Project" : "Restore missing project files",
          vscode.TreeItemCollapsibleState.None,
          { command: "xmake.init", title: "Initialize Project" },
          new vscode.ThemeIcon(fresh ? "add" : "sync"),
          "initAction",
        ),
      ];
    }
    return this.createItemsFromDefinitions(MAIN_VIEW_ITEMS);
  }
}

/**
 * Actions view provider for additional actions
 */
export class XmakeActionsViewProvider extends BaseTreeDataProvider {
  constructor(xmakeManager: XmakeManager) {
    super(xmakeManager);
  }

  protected getItems(): XmakeTreeItem[] {
    const items = this.createItemsFromDefinitions(ACTIONS_VIEW_ITEMS);

    // Project-authored tasks (anything under .lua/tasks/ that the extension does not
    // ship) get their own subcategory, and only when there is at least one. Each entry
    // invokes the single generic xmake.runTask command with its own name as the
    // argument: one command per task would clutter the palette, while a tree item can
    // only invoke commands that actually exist.
    const workspacePath = this.xmakeManager.getWorkspacePath();
    const customTasks = workspacePath ? scanCustomTasks(workspacePath) : [];

    if (customTasks.length > 0) {
      // Only tasks that declare the option are given --target: xmake rejects an
      // option a task never declared, so passing it blindly breaks the button.
      const activeTarget = this.xmakeManager.getTarget();
      const children = customTasks.map(
        (task) =>
          new XmakeTreeItem(
            task.name,
            vscode.TreeItemCollapsibleState.None,
            {
              command: "xmake.runTask",
              title: `Run ${task.name}`,
              arguments: [task.name, task.acceptsTarget ? activeTarget : undefined],
            },
            new vscode.ThemeIcon("play"),
            "customTask",
          ),
      );

      items.push(
        new XmakeTreeItem(
          `Project Tasks (${customTasks.length})`,
          vscode.TreeItemCollapsibleState.Expanded,
          undefined,
          new vscode.ThemeIcon("tools"),
          "projectTasksGroup",
          children,
        ),
      );
    }

    return items;
  }
}
