import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getErrorMessage } from "./utils";
import {
  getDefaultProjectConfig,
  CONFIG_DIR,
  TASK_FILES,
} from "./projectConfig";
import { logger } from "./logger";

/**
 * Task files shipped in `resources/tasks/` and copied into `.lua/tasks/`
 * during project initialization. The list lives in `projectConfig.ts`.
 */
const TASKS_DIR = "tasks";

/**
 * Helper around the project bootstrap files (xmake.lua + .lua/config.json +
 * .lua/tasks/*.lua) shipped with the extension.
 */
export class XmakeTemplate {
  /**
   * Read a file bundled under `resources/`. Returns an empty string if the
   * file cannot be read.
   */
  private static async readResource(...segments: string[]): Promise<string> {
    const resourcePath = join(__dirname, "..", "resources", ...segments);
    try {
      await access(resourcePath);
      return await readFile(resourcePath, "utf-8");
    } catch (error) {
      logger.warning(`Failed to load resource ${segments.join("/")}`, error);
      return "";
    }
  }

  /** Read the default xmake.lua template. */
  public static getDefaultTemplate(): Promise<string> {
    return this.readResource("xmake-template.lua");
  }

  /**
   * Create the project bootstrap files in the workspace:
   *   - `xmake.lua` from the bundled template (prompts on overwrite)
   *   - `.lua/config.json` with default values (only if missing)
   *   - `.lua/tasks/*.lua` task files (only if missing, to preserve user edits)
   *
   * @returns true if xmake.lua was written successfully.
   */
  public static async createProjectFiles(
    workspacePath: string,
  ): Promise<boolean> {
    const xmakePath = join(workspacePath, "xmake.lua");

    // xmake.lua is only written when absent. An existing xmake.lua is never
    // overwritten here — this action is "ensure project files exist", so a
    // partially initialized project keeps its customized xmake.lua and only
    // gets the missing .lua/config.json / .lua/tasks/* restored.
    try {
      if (!existsSync(xmakePath)) {
        const template = await this.getDefaultTemplate();
        await writeFile(xmakePath, template, "utf-8");
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        "Failed to create xmake.lua: " + getErrorMessage(error),
      );
      return false;
    }

    const luaDir = join(workspacePath, CONFIG_DIR);
    const tasksDir = join(luaDir, TASKS_DIR);
    const configPath = join(luaDir, "config.json");

    try {
      await mkdir(luaDir, { recursive: true });

      if (!existsSync(configPath)) {
        await writeFile(
          configPath,
          JSON.stringify(getDefaultProjectConfig(), null, 4),
          "utf-8",
        );
      }

      // Bootstrap .lua/tasks/ with the shipped task files. Existing
      // files are preserved so user customizations are not clobbered.
      await mkdir(tasksDir, { recursive: true });
      for (const taskFile of TASK_FILES) {
        const dest = join(tasksDir, taskFile);
        if (existsSync(dest)) {
          continue;
        }
        const content = await this.readResource(TASKS_DIR, taskFile);
        if (content) {
          await writeFile(dest, content, "utf-8");
        }
      }
    } catch (error) {
      vscode.window.showWarningMessage(
        "Failed to ensure .lua/ files: " + getErrorMessage(error),
      );
    }

    vscode.window.showInformationMessage(
      "Project files are ready: xmake.lua + .lua/config.json + .lua/tasks/",
    );
    return true;
  }
}
