import * as vscode from 'vscode';
import { XmakeManager, BuildStatus } from './xmakeManager';

export class XmakeStatusBar implements vscode.Disposable {
    private modeItem: vscode.StatusBarItem;
    private statusItem: vscode.StatusBarItem;
    private xmakeManager: XmakeManager;
    private disposables: vscode.Disposable[] = [];
    private statusTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor(xmakeManager: XmakeManager) {
        this.xmakeManager = xmakeManager;

        // Mode selector (debug/release)
        this.modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.modeItem.command = 'xmake.setMode';
        this.modeItem.tooltip = 'Click to change build mode';
        this.updateModeItem();

        // Build status
        this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.updateStatusItem('idle');

        // Subscribe to mode changes
        this.disposables.push(
            xmakeManager.didChangeMode(() => {
                this.updateModeItem();
                this.updateStatusItem(this.xmakeManager.getStatus());
            })
        );

        // Subscribe to build status changes
        this.disposables.push(
            xmakeManager.didChangeStatus((event) => {
                this.updateStatusItem(event.status, event.error);
            })
        );

        // Show items
        this.modeItem.show();
        this.statusItem.show();
    }

    public updateModeItem(): void {
        const mode = this.xmakeManager.getMode();
        this.modeItem.text = `$(symbol-misc) ${mode.toUpperCase()}`;
        if (mode === 'debug') {
            this.modeItem.backgroundColor = new vscode.ThemeColor('statusBarItem.debuggingBackground');
        } else {
            this.modeItem.backgroundColor = undefined;
        }
    }

    public updateStatusItem(status: BuildStatus, error?: string): void {
        const mode = this.xmakeManager.getMode();
        
        // Clear any pending timeout before updating status
        this.clearStatusTimeout();
        
        switch (status) {
            case 'idle':
                this.statusItem.text = '$(circuit-board) Xmake';
                this.statusItem.tooltip = `Click to build (${mode.toUpperCase()})`;
                this.statusItem.command = 'xmake.build';
                this.statusItem.backgroundColor = undefined;
                break;
                
            case 'building':
                this.statusItem.text = '$(sync~spin) Building...';
                this.statusItem.tooltip = `Building in ${mode.toUpperCase()} mode. Click to cancel.`;
                this.statusItem.command = 'xmake.cancelBuild';
                this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
                
            case 'success':
                this.statusItem.text = '$(check) Build OK';
                this.statusItem.tooltip = `Build successful (${mode.toUpperCase()}). Click to build again.`;
                this.statusItem.command = 'xmake.build';
                this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
                // Auto-reset to idle after 5 seconds
                this.statusTimeout = setTimeout(() => {
                    this.statusTimeout = null;
                    // Only reset if still showing success
                    if (this.xmakeManager.getStatus() === 'success') {
                        this.xmakeManager.resetBuildStatus();
                        this.updateStatusItem('idle');
                    }
                }, 5000);
                break;
                
            case 'error':
                this.statusItem.text = '$(error) Build Failed';
                this.statusItem.tooltip = error 
                    ? `Build failed: ${error}. Click to show output.`
                    : 'Build failed - check output. Click to show output.';
                this.statusItem.command = 'xmake.showOutput';
                this.statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                // Auto-reset to idle after 10 seconds (longer for errors)
                this.statusTimeout = setTimeout(() => {
                    this.statusTimeout = null;
                    if (this.xmakeManager.getStatus() === 'error') {
                        this.updateStatusItem('idle');
                    }
                }, 10000);
                break;
        }
    }

    /**
     * Clear any pending status timeout
     */
    private clearStatusTimeout(): void {
        if (this.statusTimeout) {
            clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
        }
    }

    /**
     * Reset status to idle immediately
     */
    public resetStatus(): void {
        this.clearStatusTimeout();
        this.updateStatusItem('idle');
    }

    public dispose(): void {
        // Clear pending timeout before disposing
        this.clearStatusTimeout();
        
        this.modeItem.dispose();
        this.statusItem.dispose();
        
        // Dispose all event subscriptions
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}
