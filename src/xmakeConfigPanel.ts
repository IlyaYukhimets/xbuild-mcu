import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { XmakeConfigParser} from './xmakeConfigParser';
import { XmakeTemplate } from './xmakeTemplate';
import { XmakePanelHtml } from './xmakePanelHtml';
import { execAsync, execSilent, validateXmakeConfig, toXmakeConfig, ExecError } from './utils';
import { logger } from './logger';


/**
 * Git submodule repository definition
 */
interface GitRepository {
    name: string;
    url: string;
    description: string;
    path?: string;  // Optional fixed installation path
}

/**
 * Get submodule repositories from configuration
 * Combines default repos with user-defined repos
 */
function getSubmoduleRepos(): GitRepository[] {
    const config = vscode.workspace.getConfiguration('xmake');
    const userRepos = config.get<GitRepository[]>('submoduleRepos', []);
    
    // Validate and filter repos
    return userRepos.filter(repo => {
        if (!repo.name || !repo.url) {
            logger.warning('Invalid submodule repo in config (missing name or url)', repo);
            return false;
        }
        return true;
    });
}

export class XmakeConfigPanel implements vscode.Disposable {
    public static currentPanel: XmakeConfigPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private configParser: XmakeConfigParser;
    private workspacePath: string;
    private htmlGenerator: XmakePanelHtml;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        workspacePath: string
    ) {
        this.panel = panel;
        this.workspacePath = workspacePath;
        this.configParser = new XmakeConfigParser(workspacePath);
        this.htmlGenerator = new XmakePanelHtml();

        this.updateWebview();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                if (!message || typeof message !== 'object' || !message.command) {
                    logger.warning('Invalid message received from webview');
                    return;
                }

                try {
                    await this.handleMessage(message);
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    logger.error('Error processing request', error);
                    vscode.window.showErrorMessage('Error processing request: ' + errorMsg);
                }
            },
            null,
            this.disposables
        );
    }

    private async handleMessage(message: { command: string; [key: string]: unknown }): Promise<void> {
        const repos = getSubmoduleRepos();
        
        switch (message.command) {
            case 'save': {
                const validation = validateXmakeConfig(message.config);
                if (!validation.valid) {
                    vscode.window.showErrorMessage('Invalid configuration data: ' + validation.errors.join(', '));
                    this.panel.webview.postMessage({ 
                        command: 'saveResult', 
                        success: false, 
                        errors: validation.errors 
                    });
                    return;
                }
                
                const config = toXmakeConfig(message.config);
                const saved = this.configParser.write(config);
                this.panel.webview.postMessage({ command: 'saveResult', success: saved });
                
                if (saved) {
                    vscode.window.showInformationMessage('xmake.lua configuration saved!');
                } else {
                    vscode.window.showErrorMessage('Failed to save configuration');
                }
                break;
            }
            case 'cancel':
                this.panel.dispose();
                break;
            case 'browseFile': {
                const fileUri = await vscode.window.showOpenDialog({
                    defaultUri: vscode.Uri.file(String(message.currentValue || '')),
                    filters: message.filters as { [name: string]: string[] } || {},
                    canSelectMany: false
                });
                if (fileUri && fileUri[0]) {
                    const normalizedPath = this.normalizePath(fileUri[0].fsPath);
                    this.panel.webview.postMessage({
                        command: 'setFile',
                        field: String(message.field),
                        value: normalizedPath
                    });
                }
                break;
            }
            case 'browseFolder': {
                const folderUri = await vscode.window.showOpenDialog({
                    defaultUri: vscode.Uri.file(String(message.currentValue || '')),
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false
                });
                if (folderUri && folderUri[0]) {
                    const normalizedPath = this.normalizePath(folderUri[0].fsPath);
                    this.panel.webview.postMessage({
                        command: 'setFile',
                        field: String(message.field),
                        value: normalizedPath
                    });
                }
                break;
            }
            case 'getSubmodules': {
                const isGit = await this.checkGitInitialized();
                const installed = isGit ? await this.getInstalledSubmodules() : new Map();
                this.panel.webview.postMessage({
                    command: 'submodulesData',
                    repos: repos,
                    installed: Array.from(installed.keys()),
                    isGitRepo: isGit
                });
                break;
            }
            case 'addSubmodule': {
                const gitCheck = await this.checkGitInitialized();
                if (!gitCheck) {
                    const init = await vscode.window.showWarningMessage(
                        'This is not a git repository. Initialize git first?',
                        'Initialize Git',
                        'Cancel'
                    );
                    if (init === 'Initialize Git') {
                        const inited = await this.initGitRepository();
                        if (!inited) { return; }
                    } else {
                        return;
                    }
                }
                const repoData = repos.find(r => r.name === message.repoName);
                if (repoData) {
                    let finalPath: string;
                    if (repoData.path) {
                        finalPath = repoData.path;
                    } else {
                        const defaultPath = repoData.name;
                        const customPath = await vscode.window.showInputBox({
                            prompt: 'Enter submodule path (leave empty for default)',
                            placeHolder: defaultPath,
                            value: defaultPath
                        });
                        
                        if (customPath === undefined) {
                            return;
                        }
                        finalPath = customPath.trim() || defaultPath;
                    }
                    
                    const added = await this.withProgress(
                        `Adding submodule '${finalPath}'...`,
                        () => this.addSubmodule(repoData.url, finalPath)
                    );
                    
                    if (added) {
                        const updated = await this.getInstalledSubmodules();
                        this.panel.webview.postMessage({
                            command: 'submodulesData',
                            repos: repos,
                            installed: Array.from(updated.keys()),
                            isGitRepo: true
                        });
                    }
                }
                break;
            }
            case 'removeSubmodule': {
                const submodulePath = String(message.path);
                const removed = await this.withProgress(
                    `Removing submodule '${submodulePath}'...`,
                    () => this.removeSubmodule(submodulePath)
                );
                
                if (removed) {
                    const updated = await this.getInstalledSubmodules();
                    this.panel.webview.postMessage({
                        command: 'submodulesData',
                        repos: repos,
                        installed: Array.from(updated.keys()),
                        isGitRepo: true
                    });
                }
                break;
            }
            case 'createXmakeFile': {
                const created = await XmakeTemplate.createXmakeFile(this.workspacePath);
                if (created) {
                    this.updateWebview();
                    this.panel.webview.postMessage({ command: 'xmakeCreated' });
                }
                break;
            }
        }
    }

    /**
     * Execute an operation with a progress indicator
     */
    private async withProgress<T>(
        title: string, 
        operation: () => Promise<T>,
        cancellable: boolean = false
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: title,
                cancellable: cancellable
            },
            async (progress, token) => {
                if (cancellable) {
                    token.onCancellationRequested(() => {
                        logger.info('Operation cancelled by user');
                    });
                }
                progress.report({ increment: 0 });
                const result = await operation();
                progress.report({ increment: 100 });
                return result;
            }
        );
    }

    private updateWebview(): void {
        const config = this.configParser.read();
        const xmakeExists = this.configParser.exists();
        this.panel.webview.html = this.htmlGenerator.getHtmlContent(config, xmakeExists);
    }

    private async checkGitInitialized(): Promise<boolean> {
        try {
            await execAsync('git rev-parse --git-dir', { cwd: this.workspacePath });
            return true;
        } catch {
            return false;
        }
    }

    private async initGitRepository(): Promise<boolean> {
        try {
            await execAsync('git init', { cwd: this.workspacePath });
            vscode.window.showInformationMessage('Git repository initialized');
            logger.info('Git repository initialized', { path: this.workspacePath });
            return true;
        } catch (error) {
            const execError = error as ExecError;
            const errorMsg = execError.stderr || String(error);
            logger.error('Failed to initialize git', error);
            vscode.window.showErrorMessage('Failed to initialize git: ' + errorMsg);
            return false;
        }
    }

    private async getInstalledSubmodules(): Promise<Map<string, string>> {
        const submodules = new Map<string, string>();
        
        try {
            const stdout = await execSilent('git submodule status', { cwd: this.workspacePath });
            
            if (stdout.trim()) {
                const lines = stdout.trim().split('\n');
                for (const line of lines) {
                    const match = line.trim().match(/^[+\-u ]?[a-f0-9]+\s+(\S+)\s*/);
                    if (match) {
                        submodules.set(match[1], match[1]);
                    }
                }
            }
        } catch {
            // Ignore errors
        }
        
        return submodules;
    }

    private async addSubmodule(url: string, submodulePath: string): Promise<boolean> {
        // Check for stale .git/modules directory
        const modulesPath = path.join(this.workspacePath, '.git', 'modules', submodulePath);
        if (fs.existsSync(modulesPath)) {
            const clean = await vscode.window.showWarningMessage(
                `Found stale git modules directory for '${submodulePath}'. Clean it before adding?`,
                'Clean and Add',
                'Cancel'
            );
            if (clean !== 'Clean and Add') {
                return false;
            }
            this.removeGitModulesDirectory(modulesPath);
        }
        
        const cmd = `git submodule add "${url}" "${submodulePath}"`;
        
        try {
            await execAsync(cmd, { cwd: this.workspacePath });
            const name = url.split('/').pop()?.replace('.git', '') || submodulePath;
            vscode.window.showInformationMessage('Submodule added: ' + name);
            logger.info('Submodule added', { path: submodulePath, url });
            return true;
        } catch (error) {
            const execError = error as ExecError;
            const stderr = execError.stderr || '';
            
            if (stderr.includes('already exists')) {
                vscode.window.showWarningMessage('Submodule already exists');
            } else if (stderr.includes('git directory for') && stderr.includes('is found locally')) {
                const force = await vscode.window.showWarningMessage(
                    'Stale git directory found. Force add the submodule?',
                    'Force Add',
                    'Cancel'
                );
                if (force === 'Force Add') {
                    try {
                        await execAsync(`git submodule add --force "${url}" "${submodulePath}"`, { cwd: this.workspacePath });
                        vscode.window.showInformationMessage('Submodule added (forced): ' + submodulePath);
                        logger.info('Submodule added (forced)', { path: submodulePath, url });
                        return true;
                    } catch (forceError) {
                        const forceExecError = forceError as ExecError;
                        logger.error('Failed to force add submodule', forceError);
                        vscode.window.showErrorMessage('Failed to force add submodule: ' + (forceExecError.stderr || String(forceError)));
                        return false;
                    }
                }
            } else {
                logger.error('Failed to add submodule', error);
                vscode.window.showErrorMessage('Failed to add submodule: ' + stderr);
            }
            return false;
        }
    }

    private removeGitModulesDirectory(dirPath: string): boolean {
        try {
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                logger.debug('Removed git modules directory', { path: dirPath });
                return true;
            }
        } catch (error) {
            logger.error('Failed to remove git modules directory', error);
        }
        return false;
    }

    private async removeSubmodule(submodulePath: string): Promise<boolean> {
        logger.info('Removing submodule', { path: submodulePath });
        
        // Step 1: Deinit submodule
        try {
            await execAsync(`git submodule deinit -f "${submodulePath}"`, { cwd: this.workspacePath });
        } catch (error) {
            const execError = error as ExecError;
            const stderr = execError.stderr || '';
            if (!stderr.includes('not initialized') && !stderr.includes('Submodule')) {
                vscode.window.showErrorMessage('Failed to deinit submodule: ' + stderr);
                return false;
            }
        }
        
        // Step 2: Remove from git index
        try {
            await execAsync(`git rm -f "${submodulePath}"`, { cwd: this.workspacePath });
        } catch (error) {
            const execError = error as ExecError;
            const stderr = execError.stderr || '';
            if (!stderr.includes('pathspec') && !stderr.includes('did not match')) {
                vscode.window.showErrorMessage('Failed to git rm submodule: ' + stderr);
                return false;
            }
        }
        
        // Step 3: Clean up .git/modules directory
        const modulesPath = path.join(this.workspacePath, '.git', 'modules', submodulePath);
        if (fs.existsSync(modulesPath)) {
            const removed = this.removeGitModulesDirectory(modulesPath);
            if (!removed) {
                vscode.window.showWarningMessage(
                    'Could not fully clean .git/modules directory. You may need to manually remove: ' + modulesPath
                );
            }
        }
        
        // Step 4: Remove entry from .gitmodules
        const gitmodulesPath = path.join(this.workspacePath, '.gitmodules');
        if (fs.existsSync(gitmodulesPath)) {
            try {
                let content = fs.readFileSync(gitmodulesPath, 'utf-8');
                const sectionRegex = new RegExp(
                    `\\[submodule "${submodulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\][^[]*`,
                    'g'
                );
                content = content.replace(sectionRegex, '');
                
                if (content.trim().length === 0) {
                    fs.unlinkSync(gitmodulesPath);
                    try {
                        await execAsync('git rm -f .gitmodules', { cwd: this.workspacePath });
                    } catch { /* ignore */ }
                } else {
                    fs.writeFileSync(gitmodulesPath, content, 'utf-8');
                }
            } catch (error) {
                logger.error('Failed to update .gitmodules', error);
            }
        }
        
        // Step 5: Remove from .git/config
        try {
            await execAsync(`git config --remove-section submodule.${submodulePath}`, { cwd: this.workspacePath });
        } catch { /* ignore */ }
        
        vscode.window.showInformationMessage('Submodule removed: ' + submodulePath);
        logger.info('Submodule removed', { path: submodulePath });
        return true;
    }

    private normalizePath(filePath: string): string {
        let normalized = filePath.replace(/\\/g, '/');
        const workspaceNormalized = this.workspacePath.replace(/\\/g, '/');
        if (normalized.startsWith(workspaceNormalized + '/')) {
            normalized = normalized.substring(workspaceNormalized.length + 1);
        }
        return normalized;
    }

    public static createOrShow(extensionUri: vscode.Uri, workspacePath: string): XmakeConfigPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (XmakeConfigPanel.currentPanel) {
            XmakeConfigPanel.currentPanel.panel.reveal(column);
            return XmakeConfigPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            'xmakeConfig',
            'Xmake Configuration',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        XmakeConfigPanel.currentPanel = new XmakeConfigPanel(panel, extensionUri, workspacePath);
        return XmakeConfigPanel.currentPanel;
    }

    public dispose(): void {
        // Clear static reference first to prevent race conditions
        XmakeConfigPanel.currentPanel = undefined;
        
        // Dispose all registered disposables
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            } catch (error) {
                logger.error('Error disposing resource', error);
            }
        }
        this.disposables = [];
        
        // Dispose the panel last
        try {
            this.panel.dispose();
        } catch {
            // Panel might already be disposed
        }
        
        logger.debug('XmakeConfigPanel disposed');
    }
} 
