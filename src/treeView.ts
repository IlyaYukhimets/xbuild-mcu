import * as vscode from 'vscode';
import { XmakeManager} from './xmakeManager';
import { logger } from './logger';

/**
 * Tree item for Xmake view
 */
export class XmakeTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly iconPath?: vscode.ThemeIcon | string,
        public readonly contextValue?: string
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
    private _onDidChangeTreeData = new vscode.EventEmitter<XmakeTreeItem | undefined | null | void>();
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
        return Promise.resolve([]);
    }

    /**
     * Get the tree items for this provider
     * Must be implemented by derived classes
     */
    protected abstract getItems(): XmakeTreeItem[];

    /**
     * Helper method to create tree items from definitions
     */
    protected createItemsFromDefinitions(definitions: TreeItemDefinition[]): XmakeTreeItem[] {
        return definitions.map(def => {
            const label = def.dynamicLabel 
                ? def.dynamicLabel(this.xmakeManager) 
                : def.label;
            
            return new XmakeTreeItem(
                label,
                vscode.TreeItemCollapsibleState.None,
                { command: def.commandId, title: def.commandTitle },
                new vscode.ThemeIcon(def.icon),
                def.contextValue
            );
        });
    }
}

/**
 * Main view tree items definitions
 */
const MAIN_VIEW_ITEMS: TreeItemDefinition[] = [
    {
        label: 'Project Configuration',
        commandId: 'xmake.openConfig',
        commandTitle: 'Open Configuration',
        icon: 'settings-gear'
    },
    {
        label: 'Mode',
        commandId: 'xmake.setMode',
        commandTitle: 'Set Mode',
        icon: 'symbol-misc',
        dynamicLabel: (manager) => `Mode: ${manager.getMode().toUpperCase()}`
    },
    {
        label: 'Build',
        commandId: 'xmake.build',
        commandTitle: 'Build',
        icon: 'play',
        contextValue: 'buildAction'
    },
    {
        label: 'Rebuild',
        commandId: 'xmake.rebuild',
        commandTitle: 'Rebuild',
        icon: 'refresh'
    },
    {
        label: 'Clean',
        commandId: 'xmake.clean',
        commandTitle: 'Clean',
        icon: 'trash'
    }
];

/**
 * Actions view tree items definitions
 */
const ACTIONS_VIEW_ITEMS: TreeItemDefinition[] = [
    {
        label: 'Flash (JLink)',
        commandId: 'xmake.flash',
        commandTitle: 'Flash',
        icon: 'zap'
    },
    {
        label: 'Generate Docs',
        commandId: 'xmake.docs',
        commandTitle: 'Docs',
        icon: 'book'
    },
    {
        label: 'Import CubeMX',
        commandId: 'xmake.cubemx',
        commandTitle: 'CubeMX',
        icon: 'folder-opened'
    },
    {
        label: 'Apply Template',
        commandId: 'xmake.template',
        commandTitle: 'Template',
        icon: 'file-code'
    },
    {
        label: 'List Templates',
        commandId: 'xmake.templateList',
        commandTitle: 'List Templates',
        icon: 'list-unordered'
    }
];

/**
 * Main view provider for build actions
 */
export class XmakeMainViewProvider extends BaseTreeDataProvider {
    constructor(xmakeManager: XmakeManager) {
        super(xmakeManager);
    }

    protected getItems(): XmakeTreeItem[] {
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
        return this.createItemsFromDefinitions(ACTIONS_VIEW_ITEMS);
    }
}

/**
 * Factory function to create tree item definitions
 * Useful for dynamic tree content
 */
export function createTreeItemDefinition(
    label: string,
    commandId: string,
    icon: string,
    options?: { 
        commandTitle?: string; 
        contextValue?: string;
        dynamicLabel?: (manager: XmakeManager) => string;
    }
): TreeItemDefinition {
    return {
        label,
        commandId,
        commandTitle: options?.commandTitle || label,
        icon,
        contextValue: options?.contextValue,
        dynamicLabel: options?.dynamicLabel
    };
}
