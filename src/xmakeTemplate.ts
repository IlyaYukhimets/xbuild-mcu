import * as vscode from "vscode";
import { existsSync, readdirSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getErrorMessage } from "./utils";
import {
  getDefaultProjectConfig,
  readProjectConfig,
  CONFIG_DIR,
  DEFAULT_TARGET_STEM,
  TARGETS_DIR,
  TASK_FILES,
} from "./projectConfig";
import { logger } from "./logger";

/**
 * Task files shipped in `resources/tasks/` and copied into `.lua/tasks/`
 * during project initialization. The list lives in `projectConfig.ts`.
 */
const TASKS_DIR = "tasks";

/**
 * The single target every new project gets, named after DEFAULT_TARGET_STEM so the
 * target id matches what the template builds when no target file exists at all. Its
 * content is generated rather than shipped as a resource, because the artifact name
 * has to come from the project's own config: a fixed example.json would change every
 * fresh project's artifact from <project name>.elf to example.elf.
 */
const SEED_TARGET_FILE = `${DEFAULT_TARGET_STEM}.json`;

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
      // Seed the targets directory with one example. Never overwrite: the test is
      // "any *.json present", so an existing set is left untouched and only a
      // missing or empty directory gets populated.
      const targetsDir = join(luaDir, TARGETS_DIR);
      const hasTargetFile =
        existsSync(targetsDir) &&
        readdirSync(targetsDir).some((entry) =>
          entry.toLowerCase().endsWith(".json"),
        );

      if (!hasTargetFile) {
        await mkdir(targetsDir, { recursive: true });

        // Artifact name follows the project's own name so behaviour is unchanged for
        // single-image projects ("<ProjectName>.elf", or "firmware.elf" while the
        // name is still empty). Additional targets get their own names.
        const projectName = readProjectConfig(workspacePath).name.trim();
        const seed = JSON.stringify(
          {
            name: projectName || DEFAULT_TARGET_STEM,
            defines: [],
            sources: [],
            includedirs: [],
          },
          null,
          4,
        );

        await writeFile(join(targetsDir, SEED_TARGET_FILE), seed + "\n", "utf-8");
      }
    } catch (error) {
      vscode.window.showWarningMessage(
        "Failed to ensure .lua/ files: " + getErrorMessage(error),
      );
    }

    vscode.window.showInformationMessage(
      "Project files are ready: xmake.lua + .lua/config.json + .lua/tasks/ + .lua/targets/. " +
        "Add more build targets with 'Xmake: Add Build Target'.",
    );
    return true;
  }
}
