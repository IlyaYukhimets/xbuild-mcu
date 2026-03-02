import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class XmakeTemplate {
    /**
     * Get the default xmake.lua template
     */
    public static getDefaultTemplate(): string {
        const templatePath = path.join(__dirname, '..', 'resources', 'xmake-template.lua');

        try {
            if (fs.existsSync(templatePath)) {
                const content = fs.readFileSync(templatePath, 'utf-8');
                return content;
            }
        } catch (error) {
            console.warn('Failed to load template file, using embedded fallback:', error);
        }

        return '';
    }

    /**
     * Create a new xmake.lua file in the workspace
     * @param workspacePath Path to the workspace directory
     * @returns true if file was created successfully
     */
    public static async createXmakeFile(workspacePath: string): Promise<boolean> {
        const xmakePath = path.join(workspacePath, 'xmake.lua');
        
        // Check if file already exists
        if (fs.existsSync(xmakePath)) {
            const overwrite = await vscode.window.showWarningMessage(
                'xmake.lua already exists. Overwrite?',
                'Overwrite',
                'Cancel'
            );
            if (overwrite !== 'Overwrite') {
                return false;
            }
        }
        
        try {
            const template = this.getDefaultTemplate();
            fs.writeFileSync(xmakePath, template, 'utf-8');
            vscode.window.showInformationMessage('xmake.lua created successfully!');
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage('Failed to create xmake.lua: ' + errorMessage);
            return false;
        }
    }
}
