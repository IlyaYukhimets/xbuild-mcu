import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger, LogLevel, logger } from './logger';
import { showMemoryReport } from './memoryAnalyzer';

/**
 * Build status type
 */
export type BuildStatus = 'idle' | 'building' | 'success' | 'error';

/**
 * Build mode type
 */
export type BuildMode = 'debug' | 'release';

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
    command: string;
    args?: string;
    label?: string;
    group?: vscode.TaskGroup;
    clearOutput?: boolean;
}

/**
 * Central manager for Xmake operations
 */
export class XmakeManager implements vscode.Disposable {
    private outputChannel: vscode.OutputChannel;
    private currentMode: BuildMode;
    private buildStatus: BuildStatus = 'idle';
    private lastBuildError: string | undefined;
    private currentTask: vscode.TaskExecution | undefined;
    private taskListener: vscode.Disposable | undefined;
    
    // Event emitters
    private readonly _onDidChangeMode = new vscode.EventEmitter<BuildMode>();
    public readonly didChangeMode = this._onDidChangeMode.event;
    
    private readonly _onDidChangeStatus = new vscode.EventEmitter<BuildStatusChangeEvent>();
    public readonly didChangeStatus = this._onDidChangeStatus.event;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Xmake Build');
        this.currentMode = this.getConfig('defaultMode', 'debug');
        
        // Set log level based on configuration
        const verbose = this.getConfig('verboseLogging', false);
        logger.setLevel(verbose ? LogLevel.DEBUG : LogLevel.INFO);
        
        // Listen for task completion
        this.taskListener = vscode.tasks.onDidEndTaskProcess((e) => this.onTaskEnd(e));
        
        logger.info('XmakeManager initialized', { mode: this.currentMode });
    }

    /**
     * Get configuration value
     */
    private getConfig<T>(key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration('xmake').get(key, defaultValue);
    }

    /**
     * Get workspace path
     */
    public getWorkspacePath(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Get the xmake executable path
     */
    private getXmakePath(): string {
        return this.getConfig<string>('xmakePath', 'xmake');
    }

    /**
     * Build xmake command with proper path
     */
    private xmakeCmd(args: string): string {
        const xmakePath = this.getXmakePath();
        if (xmakePath.includes(' ')) {
            return `"${xmakePath}" ${args}`;
        }
        return `${xmakePath} ${args}`;
    }

    /**
     * Detect if the current shell is PowerShell
     * Checks multiple indicators for reliability
     */
    private isPowerShell(): boolean {
        // Check SHELL environment variable (works on Unix/Git Bash)
        const shellEnv = process.env.SHELL || '';
        if (shellEnv.toLowerCase().includes('powershell') || 
            shellEnv.toLowerCase().includes('pwsh')) {
            return true;
        }
        
        // On Windows, check for PowerShell indicators
        if (process.platform === 'win32') {
            // PowerShell sets PSModulePath
            if (process.env.PSModulePath) {
                return true;
            }
            // Check if ComSpec points to PowerShell (rare but possible)
            const comSpec = process.env.ComSpec || '';
            if (comSpec.toLowerCase().includes('powershell') || 
                comSpec.toLowerCase().includes('pwsh')) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Get the command separator for the current shell
     * PowerShell uses ';', cmd/bash use '&&'
     */
    private getCommandSeparator(): string {
        return this.isPowerShell() ? '; ' : ' && ';
    }

    /**
     * Handle task completion
     */
    private onTaskEnd(e: vscode.TaskProcessEndEvent): void {
        // Check if this is our xmake task
        const task = e.execution.task;
        const definition = task.definition as { type?: string; command?: string };
        
        if (definition.type !== 'xmake' && !task.name.includes('Xmake')) {
            return;
        }
        
        logger.debug('Task ended', { 
            name: task.name, 
            exitCode: e.exitCode,
            command: definition.command 
        });
        
        // Update build status based on exit code
        if (this.buildStatus === 'building') {
            if (e.exitCode === 0) {
                this.setBuildStatus('success');
                vscode.window.showInformationMessage(`Build completed successfully (${this.currentMode})`);
                
                // Show memory report after successful build
                const workspacePath = this.getWorkspacePath();
                if (workspacePath) {
                    showMemoryReport(workspacePath);
                }
            } else if (e.exitCode !== undefined) {
                this.setBuildStatus('error', `Exit code: ${e.exitCode}`);
                vscode.window.showErrorMessage(`Build failed with exit code ${e.exitCode}. Check output for details.`);
            }
        }
        
        this.currentTask = undefined;
    }

    /**
     * Set build status and emit event
     */
    private setBuildStatus(status: BuildStatus, error?: string): void {
        this.buildStatus = status;
        this.lastBuildError = error;
        
        this._onDidChangeStatus.fire({
            status,
            mode: this.currentMode,
            error
        });
        
        logger.debug('Build status changed', { status, mode: this.currentMode, error });
    }

    /**
     * Reset build status to idle (for statusBar)
     */
    public resetBuildStatus(): void {
        this.buildStatus = 'idle';
        this.lastBuildError = undefined;
    }

    /**
     * Get current build mode
     */
    public getMode(): BuildMode {
        return this.currentMode;
    }

    /**
     * Set mode synchronously without UI
     */
    public setModeSync(mode: BuildMode): void {
        this.currentMode = mode;
        this._onDidChangeMode.fire(mode);
        logger.info('Mode set', { mode });
    }

    /**
     * Get current build status
     */
    public getStatus(): BuildStatus {
        return this.buildStatus;
    }

    /**
     * Get last build error
     */
    public getLastBuildError(): string | undefined {
        return this.lastBuildError;
    }

    /**
     * Check if xmake.lua exists in workspace
     */
    public async checkProject(): Promise<boolean> {
        const workspacePath = this.getWorkspacePath();
        if (!workspacePath) {
            logger.warning('No workspace folder open');
            return false;
        }

        const xmakeFile = path.join(workspacePath, 'xmake.lua');
        if (!fs.existsSync(xmakeFile)) {
            this.log('xmake.lua not found in workspace');
            return false;
        }

        this.log('Found xmake.lua project');
        return true;
    }

    /**
     * Create a task for xmake command
     */
    private createTask(options: TaskOptions): vscode.Task {
        const { command, args, label, group, clearOutput } = options;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workspacePath = workspaceFolder?.uri.fsPath || '';
        
        const cmdLine = this.xmakeCmd(command + (args ? ` ${args}` : ''));
        
        const definition = {
            type: 'xmake',
            command: command
        };
        
        const execution = new vscode.ShellExecution(cmdLine, {
            cwd: workspacePath
        });
        
        const task = new vscode.Task(
            definition,
            workspaceFolder || vscode.TaskScope.Workspace,
            label || `Xmake ${command}`,
            'xmake',
            execution,
            '$xmake-gcc'
        );
        
        // Show output panel
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Shared,
            clear: clearOutput ?? this.getConfig('clearOutputBeforeBuild', true)
        };
        
        task.group = group;
        
        return task;
    }

    /**
     * Create a compound task with multiple commands
     */
    private createCompoundTask(
        commands: string[], 
        label: string, 
        options?: { group?: vscode.TaskGroup; clearOutput?: boolean }
    ): vscode.Task {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const workspacePath = workspaceFolder?.uri.fsPath || '';
        
        const separator = this.getCommandSeparator();
        const fullCmd = commands.join(separator);
        
        const definition = {
            type: 'xmake',
            command: label.toLowerCase().replace(/\s+/g, '_')
        };
        
        const execution = new vscode.ShellExecution(fullCmd, {
            cwd: workspacePath
        });
        
        const task = new vscode.Task(
            definition,
            workspaceFolder || vscode.TaskScope.Workspace,
            label,
            'xmake',
            execution,
            '$xmake-gcc'
        );
        
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            panel: vscode.TaskPanelKind.Shared,
            clear: options?.clearOutput ?? this.getConfig('clearOutputBeforeBuild', true)
        };
        
        task.group = options?.group;
        
        return task;
    }

    /**
     * Execute a task and return the execution
     */
    private async executeTask(task: vscode.Task): Promise<vscode.TaskExecution> {
        // Cancel any running task
        if (this.currentTask) {
            this.currentTask.terminate();
            this.currentTask = undefined;
        }
        
        const execution = await vscode.tasks.executeTask(task);
        this.currentTask = execution;
        return execution;
    }

    /**
     * Build the project
     */
    public async build(mode?: BuildMode): Promise<void> {
        const buildMode = mode || this.currentMode;
        
        this.setBuildStatus('building');
        this.log(`Building in ${buildMode} mode...`);
        
        const configureCmd = this.xmakeCmd(`f -m ${buildMode} -y`);
        const buildCmd = this.xmakeCmd('-v');
        
        const task = this.createCompoundTask(
            [configureCmd, buildCmd],
            `Xmake Build (${buildMode})`,
            { group: vscode.TaskGroup.Build }
        );
        
        await this.executeTask(task);
    }

    /**
     * Clean build artifacts
     */
    public async clean(): Promise<void> {
        this.log('Cleaning project...');
        this.setBuildStatus('idle');
        
        const task = this.createTask({ command: 'clean' });
        await this.executeTask(task);
    }

    /**
     * Rebuild the project
     */
    public async rebuild(): Promise<void> {
        this.setBuildStatus('building');
        this.log('Rebuilding project...');
        
        const cleanCmd = this.xmakeCmd('f -c');
        const cleanBuildCmd = this.xmakeCmd('clean');
        const configureCmd = this.xmakeCmd(`f -m ${this.currentMode} -y`);
        const buildCmd = this.xmakeCmd('-r -v');
        
        const task = this.createCompoundTask(
            [cleanCmd, cleanBuildCmd, configureCmd, buildCmd],
            'Xmake Rebuild',
            { group: vscode.TaskGroup.Build, clearOutput: true }
        );
        
        await this.executeTask(task);
    }

    /**
     * Flash firmware via JLink
     */
    public async flash(): Promise<void> {
        const jlinkPath = this.getConfig<string>('jlinkPath', 'JLink.exe');
        const flashSpeed = this.getConfig<number>('flashSpeed', 4000);
        
        // Check if JLink exists (only if it's an absolute path)
        if (path.isAbsolute(jlinkPath) && !fs.existsSync(jlinkPath)) {
            const result = await vscode.window.showWarningMessage(
                `JLink not found at: ${jlinkPath}`,
                'Open Settings',
                'Continue Anyway'
            );
            if (result === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'xmake.jlinkPath');
                return;
            }
            if (result !== 'Continue Anyway') {
                return;
            }
        }

        this.log(`Flashing via JLink at ${flashSpeed} kHz...`);
        
        const task = this.createTask({ command: 'flash' });
        await this.executeTask(task);
    }

    /**
     * Generate Doxygen documentation
     */
    public async docs(): Promise<void> {
        this.log('Generating Doxygen documentation...');
        
        const task = this.createTask({ command: 'docs' });
        await this.executeTask(task);
    }

    /**
     * Import project from CubeMX
     */
    public async cubemx(): Promise<void> {
        const cubemxPath = await vscode.window.showInputBox({
            prompt: 'Enter path to CubeMX project',
            placeHolder: 'C:/Projects/MyCubeMXProject',
            validateInput: (value) => {
                if (!value) {
                    return 'Path is required';
                }
                if (!fs.existsSync(value)) {
                    return 'Path does not exist';
                }
                return null;
            }
        });

        if (!cubemxPath) {
            return;
        }

        this.log(`Importing from CubeMX: ${cubemxPath}`);
        
        const task = this.createTask({ 
            command: 'cubemx', 
            args: `--path="${cubemxPath}"`,
            label: 'Xmake CubeMX Import'
        });
        await this.executeTask(task);
    }

    /**
     * Apply a template
     */
    public async template(): Promise<void> {
        const templatesPath = this.getConfig<string>('templatesPath', 'templates');
        const workspacePath = this.getWorkspacePath();
        
        if (!workspacePath) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const fullTemplatesPath = path.join(workspacePath, templatesPath);
        
        if (!fs.existsSync(fullTemplatesPath)) {
            const result = await vscode.window.showWarningMessage(
                `Templates folder not found: ${templatesPath}`,
                'Add as Submodule',
                'Cancel'
            );
            if (result === 'Add as Submodule') {
                const submoduleUrl = await vscode.window.showInputBox({
                    prompt: 'Enter templates repository URL',
                    placeHolder: 'git@your-server.com:templates.git'
                });
                if (submoduleUrl) {
                    // Run git command in terminal
                    const terminal = vscode.window.createTerminal('Git');
                    terminal.show();
                    terminal.sendText(`git submodule add ${submoduleUrl} ${templatesPath}`);
                }
            }
            return;
        }

        const templates = fs.readdirSync(fullTemplatesPath).filter(f => {
            return fs.statSync(path.join(fullTemplatesPath, f)).isDirectory();
        });

        if (templates.length === 0) {
            vscode.window.showWarningMessage('No templates found in ' + templatesPath);
            return;
        }

        const selected = await vscode.window.showQuickPick(templates, {
            placeHolder: 'Select a template to apply'
        });

        if (!selected) {
            return;
        }

        this.log(`Applying template: ${selected}`);
        
        const task = this.createTask({ 
            command: 'template', 
            args: `--mcu=${selected}` 
        });
        await this.executeTask(task);
    }

    /**
     * List available templates
     */
    public async templateList(): Promise<void> {
        this.log('Listing available templates...');
        
        const task = this.createTask({ 
            command: 'template', 
            args: '--list' 
        });
        await this.executeTask(task);
    }

    /**
     * Show UI to select build mode
     */
    public async setMode(): Promise<void> {
        const items: BuildMode[] = ['debug', 'release'];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Current mode: ${this.currentMode}`
        });

        if (selected && (selected === 'debug' || selected === 'release')) {
            this.currentMode = selected;
            this._onDidChangeMode.fire(selected);
            this.log(`Build mode set to: ${selected}`);
            vscode.window.showInformationMessage(`Xmake build mode: ${selected}`);
        }
    }

    /**
     * Log message with timestamp
     */
    private log(message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        logger.debug(message);
    }

    /**
     * Open the output channel
     */
    public showOutput(): void {
        this.outputChannel.show();
    }

    /**
     * Open the log output channel
     */
    public showLog(): void {
        logger.show();
    }

    /**
     * Cancel current build
     */
    public cancelBuild(): void {
        if (this.currentTask) {
            this.currentTask.terminate();
            this.currentTask = undefined;
            this.setBuildStatus('idle');
            this.log('Build cancelled');
        }
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        if (this.currentTask) {
            this.currentTask.terminate();
            this.currentTask = undefined;
        }
        if (this.taskListener) {
            this.taskListener.dispose();
            this.taskListener = undefined;
        }
        this.outputChannel.dispose();
        this._onDidChangeMode.dispose();
        this._onDidChangeStatus.dispose();
    }
}
