import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getErrorMessage } from "./utils";
import { logger } from "./logger";

/**
 * Helper around the default xmake.lua template shipped with the extension.
 */
export class XmakeTemplate {
  /**
   * Read the default xmake.lua template bundled with the extension.
   * Returns an empty string if the template file cannot be read.
   */
  public static async getDefaultTemplate(): Promise<string> {
    const templatePath = join(
      __dirname,
      "..",
      "resources",
      "xmake-template.lua",
    );
    try {
      await access(templatePath);
      return await readFile(templatePath, "utf-8");
    } catch (error) {
      logger.warning(
        "Failed to load template file, using empty fallback",
        error,
      );
      return "";
    }
  }

  /**
   * Create a new xmake.lua file in the workspace, prompting for overwrite
   * when the file already exists.
   *
   * @returns true if the file was created successfully.
   */
  public static async createXmakeFile(workspacePath: string): Promise<boolean> {
    const xmakePath = join(workspacePath, "xmake.lua");

    if (existsSync(xmakePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        "xmake.lua already exists. Overwrite?",
        "Overwrite",
        "Cancel",
      );
      if (overwrite !== "Overwrite") {
        return false;
      }
    }

    try {
      const template = await this.getDefaultTemplate();
      await writeFile(xmakePath, template, "utf-8");
      vscode.window.showInformationMessage("xmake.lua created successfully!");
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(
        "Failed to create xmake.lua: " + getErrorMessage(error),
      );
      return false;
    }
  }
}
