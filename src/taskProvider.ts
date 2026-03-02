import * as vscode from 'vscode';
import { XmakeManager } from './xmakeManager';
import { logger } from './logger';

export class XmakeTaskProvider implements vscode.TaskProvider {
    static xmakeType = 'xmake';
    private tasks: vscode.Task[] | undefined;
    private xmakeManager: XmakeManager;

    constructor(xmakeManager: XmakeManager) {
        this.xmakeManager = xmakeManager;
    }

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

    /**
     * Get xmake executable path from configuration
     */
    private getXmakePath(): string {
        return vscode.workspace.getConfiguration('xmake').get('xmakePath', 'xmake');
    }

    /**
     * Build xmake command with proper path
     */
    private xmake(args: string): string {
        const xmakePath = this.getXmakePath();
        if (xmakePath.includes(' ')) {
            return `"${xmakePath}" ${args}`;
        }
        return `${xmakePath} ${args}`;
    }

    private getTasks(): vscode.Task[] {
        if (this.tasks !== undefined) {
            return this.tasks;
        }

        this.tasks = [];
        
        const commands = [
            { command: 'configure', label: 'Configure' },
            { command: 'build', label: 'Build', mode: 'debug' },
            { command: 'build', label: 'Build Release', mode: 'release' },
            { command: 'clean', label: 'Clean' },
            { command: 'rebuild', label: 'Rebuild' },
            { command: 'flash', label: 'Flash' },
            { command: 'docs', label: 'Generate Docs' },
        ];

        for (const cmd of commands) {
            const task = this.createTask(cmd.command, cmd.mode, cmd.label);
            if (task) {
                this.tasks.push(task);
            }
        }

        logger.debug(`Registered ${this.tasks.length} xmake tasks`);
        return this.tasks;
    }

    private createTask(command: string, mode?: string, label?: string): vscode.Task | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        const definition: XmakeTaskDefinition = {
            type: XmakeTaskProvider.xmakeType,
            command: command,
            mode: mode
        };

        const taskLabel = label || `Xmake ${command}`;
        
        let cmdLine = this.xmake(command);
        if (command === 'build' && mode) {
            cmdLine = `${this.xmake(`f -m ${mode} -y`)} && ${this.xmake('')}`;
        }

        const execution = new vscode.ShellExecution(cmdLine, {
            cwd: workspaceFolder.uri.fsPath
        });

        const task = new vscode.Task(
            definition,
            workspaceFolder,
            taskLabel,
            'xmake',
            execution,
            '$xmake-gcc' // Problem matcher
        );

        task.group = command === 'build' ? vscode.TaskGroup.Build : undefined;
        
        return task;
    }
}

interface XmakeTaskDefinition extends vscode.TaskDefinition {
    command: string;
    mode?: string;
}
