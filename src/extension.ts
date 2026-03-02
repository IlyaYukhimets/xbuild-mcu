import * as vscode from 'vscode';
import { XmakeManager } from './xmakeManager';
import { XmakeStatusBar } from './statusBar';
import { XmakeTaskProvider } from './taskProvider';
import { XmakeMainViewProvider, XmakeActionsViewProvider } from './treeView';
import { XmakeConfigPanel } from './xmakeConfigPanel';
import { Logger, LogLevel, logger } from './logger';

/**
 * Command definition interface
 */
interface CommandDefinition {
    id: string;
    handler: (context: vscode.ExtensionContext) => void;
}

/**
 * Global extension state
 */
interface ExtensionState {
    xmakeManager: XmakeManager;
    statusBar: XmakeStatusBar;
    taskProvider: vscode.Disposable;
    mainViewProvider: XmakeMainViewProvider;
    actionsViewProvider: XmakeActionsViewProvider;
    workspacePath: string | undefined;
    extensionUri: vscode.Uri | undefined;
    configChangeListener: vscode.Disposable | undefined;
}

let state: ExtensionState | undefined;
let isActivated = false;

/**
 * Create command definitions with access to extension state
 */
function createCommandDefinitions(): CommandDefinition[] {
    if (!state) {
        return [];
    }
    
    return [
        {
            id: 'xmake.openConfig',
            handler: () => {
                if (state && state.workspacePath && state.extensionUri) {
                    XmakeConfigPanel.createOrShow(state.extensionUri, state.workspacePath);
                } else {
                    vscode.window.showErrorMessage('No workspace folder open');
                }
            }
        },
        {
            id: 'xmake.build',
            handler: () => {
                if (state) {
                    state.xmakeManager.build();
                    state.mainViewProvider.refresh();
                }
            }
        },
        {
            id: 'xmake.buildDebug',
            handler: () => {
                if (state) {
                    state.xmakeManager.build('debug');
                    state.mainViewProvider.refresh();
                }
            }
        },
        {
            id: 'xmake.buildRelease',
            handler: () => {
                if (state) {
                    state.xmakeManager.build('release');
                    state.mainViewProvider.refresh();
                }
            }
        },
        {
            id: 'xmake.clean',
            handler: () => {
                state?.xmakeManager.clean();
            }
        },
        {
            id: 'xmake.rebuild',
            handler: () => {
                state?.xmakeManager.rebuild();
            }
        },
        {
            id: 'xmake.flash',
            handler: () => {
                state?.xmakeManager.flash();
            }
        },
        {
            id: 'xmake.docs',
            handler: () => {
                state?.xmakeManager.docs();
            }
        },
        {
            id: 'xmake.cubemx',
            handler: () => {
                state?.xmakeManager.cubemx();
            }
        },
        {
            id: 'xmake.template',
            handler: () => {
                state?.xmakeManager.template();
            }
        },
        {
            id: 'xmake.templateList',
            handler: () => {
                state?.xmakeManager.templateList();
            }
        },
        {
            id: 'xmake.setMode',
            handler: () => {
                if (state) {
                    state.xmakeManager.setMode().then(() => {
                        state?.mainViewProvider.refresh();
                    });
                }
            }
        },
        {
            id: 'xmake.refresh',
            handler: () => {
                if (state) {
                    state.mainViewProvider.refresh();
                    state.actionsViewProvider.refresh();
                }
            }
        },
        {
            id: 'xmake.showOutput',
            handler: () => {
                state?.xmakeManager.showOutput();
            }
        },
        {
            id: 'xmake.showLog',
            handler: () => {
                state?.xmakeManager.showLog();
            }
        },
        {
            id: 'xmake.cancelBuild',
            handler: () => {
                if (state) {
                    state.xmakeManager.cancelBuild();
                    vscode.window.showInformationMessage('Build cancelled');
                }
            }
        }
    ];
}

/**
 * Register all commands from definitions
 */
function registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    const definitions = createCommandDefinitions();
    
    return definitions.map(def => 
        vscode.commands.registerCommand(def.id, () => def.handler(context))
    );
}

/**
 * Initialize extension components
 */
function initializeComponents(context: vscode.ExtensionContext): void {
    if (!state) {
        return;
    }
    
    state.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    state.extensionUri = context.extensionUri;

    // Configure logger based on settings
    const config = vscode.workspace.getConfiguration('xmake');
    const verbose = config.get<boolean>('verboseLogging', false);
    logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);

    // Initialize manager first (core component)
    state.xmakeManager = new XmakeManager();
    
    // Initialize UI components
    state.statusBar = new XmakeStatusBar(state.xmakeManager);
    state.taskProvider = vscode.tasks.registerTaskProvider(
        'xmake', 
        new XmakeTaskProvider(state.xmakeManager)
    );
    
    // Initialize tree views
    state.mainViewProvider = new XmakeMainViewProvider(state.xmakeManager);
    state.actionsViewProvider = new XmakeActionsViewProvider(state.xmakeManager);
    
    logger.info('Extension components initialized');
}

/**
 * Register tree views
 */
function registerTreeViews(context: vscode.ExtensionContext): vscode.Disposable[] {
    if (!state) {
        return [];
    }
    
    return [
        vscode.window.registerTreeDataProvider('xmake.mainView', state.mainViewProvider),
        vscode.window.registerTreeDataProvider('xmake.actionsView', state.actionsViewProvider)
    ];
}

/**
 * Setup event listeners
 */
function setupEventListeners(context: vscode.ExtensionContext): vscode.Disposable[] {
    if (!state) {
        return [];
    }
    
    const disposables: vscode.Disposable[] = [];
    
    // Mode change updates tree view
    disposables.push(
        state.xmakeManager.didChangeMode(() => {
            state?.mainViewProvider.refresh();
        })
    );
    
    // Listen for configuration changes
    state.configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('xmake')) {
            logger.debug('Configuration changed, updating settings');
            
            // Update log level if changed
            const config = vscode.workspace.getConfiguration('xmake');
            const verbose = config.get<boolean>('verboseLogging', false);
            logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);
        }
    });
    disposables.push(state.configChangeListener);
    
    return disposables;
}

export function activate(context: vscode.ExtensionContext): void {
    if (isActivated) {
        logger.warning('Extension already activated');
        return;
    }
    
    logger.info('Xmake Tools extension is activating...');

    // Check workspace trust
    if (!vscode.workspace.isTrusted) {
        logger.warning('Workspace is not trusted. Extension will not activate.');
        vscode.window.showWarningMessage(
            'Xmake Tools requires a trusted workspace to run build commands. ' +
            'Please trust this workspace to use the extension.'
        );
        return;
    }

    // Initialize state object
    state = {} as ExtensionState;

    // Initialize all components
    initializeComponents(context);

    // Register all disposables
    const commands = registerCommands(context);
    const treeViews = registerTreeViews(context);
    const eventListeners = setupEventListeners(context);

    // Add all to subscriptions
    context.subscriptions.push(
        ...commands,
        state.statusBar,
        state.taskProvider,
        state.xmakeManager, // Add manager for proper disposal
        ...treeViews,
        ...eventListeners,
        // Register logger for cleanup
        { dispose: () => logger.dispose() }
    );

    // Check for xmake.lua
    if (state.workspacePath) {
        state.xmakeManager.checkProject().then((found) => {
            if (!found) {
                logger.info('No xmake.lua found in workspace');
            }
        }).catch((error) => {
            logger.error('Failed to check project', error);
        });
    }

    isActivated = true;
    logger.info('Xmake Tools extension is now active');
}

export function deactivate(): void {
    if (!isActivated || !state) {
        return;
    }
    
    logger.info('Xmake Tools extension is deactivating...');
    
    // Dispose in reverse order of creation
    try {
        if (state.configChangeListener) {
            state.configChangeListener.dispose();
        }
        if (state.statusBar) {
            state.statusBar.dispose();
        }
        if (state.taskProvider) {
            state.taskProvider.dispose();
        }
        if (state.xmakeManager) {
            state.xmakeManager.dispose();
        }
    } catch (error) {
        logger.error('Error during deactivation', error);
    }
    
    state = undefined;
    isActivated = false;
    
    logger.info('Xmake Tools extension deactivated');
}
