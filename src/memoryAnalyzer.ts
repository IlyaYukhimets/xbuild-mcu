import * as vscode from "vscode";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { execAsync, getErrorMessage } from "./utils";

/**
 * Memory analysis result
 */
interface MemoryInfo {
  text: number;
  data: number;
  bss: number;
  dec: number;
  filename: string;
}

/**
 * Memory regions from linker script
 */
interface MemoryRegions {
  flash: number;
  ram: number;
  flashOrigin: string;
  ramOrigin: string;
}

/**
 * Parse a size string like "20K", "128K", "65536" into bytes.
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.trim().match(/^(\d+(?:\.\d+)?)(K|M)?$/i);
  if (!match) {
    return parseInt(sizeStr, 10) || 0;
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] ?? "").toUpperCase();

  if (unit === "K") {
    return Math.round(value * 1024);
  }
  if (unit === "M") {
    return Math.round(value * 1024 * 1024);
  }
  return Math.round(value);
}

/**
 * Parse a linker script (.ld) to extract the MEMORY region.
 */
function parseLinkerScript(ldPath: string): MemoryRegions | null {
  if (!existsSync(ldPath)) {
    return null;
  }

  const content = readFileSync(ldPath, "utf-8");
  const memoryMatch = content.match(/MEMORY\s*\{([^}]+)\}/s);
  if (!memoryMatch) {
    return null;
  }

  const memoryBlock = memoryMatch[1];
  let flash = 0;
  let ram = 0;
  let flashOrigin = "";
  let ramOrigin = "";

  const regionRegex =
    /(\w+)\s*\([^)]*\)\s*:\s*ORIGIN\s*=\s*([^,]+),\s*LENGTH\s*=\s*([^\n\r]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = regionRegex.exec(memoryBlock)) !== null) {
    const name = match[1].toUpperCase();
    const origin = match[2].trim();
    const length = parseSize(match[3].trim());

    if (name.includes("FLASH") || name.includes("ROM")) {
      flash = length;
      flashOrigin = origin;
    } else if (name.includes("RAM") || name.includes("SRAM")) {
      ram = length;
      ramOrigin = origin;
    }
  }

  if (flash === 0 && ram === 0) {
    return null;
  }

  return { flash, ram, flashOrigin, ramOrigin };
}

/**
 * Resolve the linker script path referenced by xmake.lua.
 */
function getLinkerScriptPath(workspacePath: string): string | null {
  const xmakePath = join(workspacePath, "xmake.lua");
  if (!existsSync(xmakePath)) {
    return null;
  }

  const content = readFileSync(xmakePath, "utf-8");
  const varMatch = content.match(/local\s+LD_SCRIPT\s*=\s*["']([^"']+)["']/i);
  if (!varMatch) {
    return null;
  }

  const ldScript = varMatch[1];
  if (isAbsolute(ldScript)) {
    return ldScript;
  }

  const possiblePaths = [
    join(workspacePath, ldScript),
    join(workspacePath, "board", ldScript),
    join(workspacePath, "ld", ldScript),
    join(workspacePath, "linker", ldScript),
  ];

  return possiblePaths.find((p) => existsSync(p)) ?? null;
}

/**
 * Recursively find ELF files within a directory.
 */
function findElfFiles(buildDir: string): string[] {
  if (!existsSync(buildDir)) {
    return [];
  }

  const elfFiles: string[] = [];
  const searchDir = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.name.endsWith(".elf")) {
        elfFiles.push(fullPath);
      }
    }
  };
  searchDir(buildDir);
  return elfFiles;
}

/**
 * Run `arm-none-eabi-size` on an ELF file and return its raw output.
 */
async function runSizeCommand(elfPath: string): Promise<string> {
  const { stdout } = await execAsync(`arm-none-eabi-size "${elfPath}"`, {
    cwd: "",
  });
  return stdout;
}

/**
 * Parse the textual output of `arm-none-eabi-size`.
 */
function parseSizeOutput(output: string): MemoryInfo | null {
  for (const line of output.trim().split("\n")) {
    const match = line
      .trim()
      .match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9a-fA-F]+)\s+(.+)$/);
    if (match) {
      return {
        text: parseInt(match[1], 10),
        data: parseInt(match[2], 10),
        bss: parseInt(match[3], 10),
        dec: parseInt(match[4], 10),
        filename: match[6].trim(),
      };
    }
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes}  B`;
}

function formatPercent(used: number, total: number): string {
  if (total === 0) {
    return "N/A";
  }
  return ((used / total) * 100).toFixed(1);
}

/** Right-align a string within a fixed width. */
const rightPad = (str: string, width: number): string => str.padStart(width);
/** Left-align a string within a fixed width. */
const leftPad = (str: string, width: number): string => str.padEnd(width);

/**
 * Analyze memory usage of built ELF files and print a report to a
 * dedicated output channel.
 */
export async function showMemoryReport(workspacePath: string): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Xmake Memory");
  outputChannel.show(true);

  const possibleBuildDirs = [
    join(workspacePath, "build"),
    join(workspacePath, "bin"),
    workspacePath,
  ];

  let elfFiles: string[] = [];
  for (const buildDir of possibleBuildDirs) {
    elfFiles = findElfFiles(buildDir);
    if (elfFiles.length > 0) {
      break;
    }
  }

  if (elfFiles.length === 0) {
    outputChannel.appendLine("");
    outputChannel.appendLine("No ELF files found. Build the project first.");
    return;
  }

  const ldPath = getLinkerScriptPath(workspacePath);
  const memoryRegions = ldPath ? parseLinkerScript(ldPath) : null;
  const flashTotal = memoryRegions?.flash ?? 0;
  const ramTotal = memoryRegions?.ram ?? 0;

  const col1 = 22; // Section
  const col2 = 14; // Used bytes
  const col3 = 10; // Used %
  const col4 = 14; // Remain
  const col5 = 14; // Total

  const line =
    "+".padEnd(col1 + 1, "-") +
    "+".padEnd(col2 + 1, "-") +
    "+".padEnd(col3 + 1, "-") +
    "+".padEnd(col4 + 1, "-") +
    "+".padEnd(col5 + 1, "-") +
    "+";
  const headerLine =
    "+".padEnd(col1 + col2 + col3 + col4 + col5 + 5, "=") + "+";

  for (const elfPath of elfFiles) {
    try {
      const output = await runSizeCommand(elfPath);
      const info = parseSizeOutput(output);
      if (!info) {
        continue;
      }

      const flashUsed = info.text + info.data;
      const ramUsed = info.data + info.bss;
      const flashRemain = flashTotal ? flashTotal - flashUsed : 0;
      const ramRemain = ramTotal ? ramTotal - ramUsed : 0;

      outputChannel.appendLine("");
      outputChannel.appendLine(headerLine);
      outputChannel.appendLine(
        "|" +
          leftPad(
            "Memory Usage Summary",
            col1 + col2 + col3 + col4 + col5 + 4,
          ) +
          "|",
      );
      outputChannel.appendLine(headerLine);
      outputChannel.appendLine(line);

      outputChannel.appendLine(
        "|" +
          leftPad("Section", col1) +
          "|" +
          rightPad("Used", col2) +
          "|" +
          rightPad("Use%", col3) +
          "|" +
          rightPad("Remain", col4) +
          "|" +
          rightPad("Total", col5) +
          "|",
      );
      outputChannel.appendLine(line);

      // Flash
      outputChannel.appendLine(
        "|" +
          leftPad("Flash", col1) +
          "|" +
          rightPad(formatBytes(flashUsed), col2) +
          "|" +
          rightPad(
            flashTotal ? formatPercent(flashUsed, flashTotal) : "N/A",
            col3,
          ) +
          "|" +
          rightPad(flashTotal ? formatBytes(flashRemain) : "N/A", col4) +
          "|" +
          rightPad(flashTotal ? formatBytes(flashTotal) : "N/A", col5) +
          "|",
      );
      outputChannel.appendLine(
        "|" +
          leftPad("   .text", col1) +
          "|" +
          rightPad(formatBytes(info.text), col2) +
          "|" +
          rightPad(
            flashTotal ? formatPercent(info.text, flashTotal) : "",
            col3,
          ) +
          "|" +
          rightPad("", col4) +
          "|" +
          rightPad("", col5) +
          "|",
      );
      outputChannel.appendLine(
        "|" +
          leftPad("   .data", col1) +
          "|" +
          rightPad(formatBytes(info.data), col2) +
          "|" +
          rightPad(
            flashTotal ? formatPercent(info.data, flashTotal) : "",
            col3,
          ) +
          "|" +
          rightPad("", col4) +
          "|" +
          rightPad("", col5) +
          "|",
      );

      outputChannel.appendLine(line);

      // RAM
      outputChannel.appendLine(
        "|" +
          leftPad("RAM", col1) +
          "|" +
          rightPad(formatBytes(ramUsed), col2) +
          "|" +
          rightPad(ramTotal ? formatPercent(ramUsed, ramTotal) : "N/A", col3) +
          "|" +
          rightPad(ramTotal ? formatBytes(ramRemain) : "N/A", col4) +
          "|" +
          rightPad(ramTotal ? formatBytes(ramTotal) : "N/A", col5) +
          "|",
      );
      outputChannel.appendLine(
        "|" +
          leftPad("   .data", col1) +
          "|" +
          rightPad(formatBytes(info.data), col2) +
          "|" +
          rightPad(ramTotal ? formatPercent(info.data, ramTotal) : "", col3) +
          "|" +
          rightPad("", col4) +
          "|" +
          rightPad("", col5) +
          "|",
      );
      outputChannel.appendLine(
        "|" +
          leftPad("   .bss", col1) +
          "|" +
          rightPad(formatBytes(info.bss), col2) +
          "|" +
          rightPad(ramTotal ? formatPercent(info.bss, ramTotal) : "", col3) +
          "|" +
          rightPad("", col4) +
          "|" +
          rightPad("", col5) +
          "|",
      );

      outputChannel.appendLine(line);
      outputChannel.appendLine("");

      outputChannel.appendLine(`Total image size: ${formatBytes(info.dec)}`);
      outputChannel.appendLine(`File: ${info.filename}`);

      if (memoryRegions && ldPath) {
        outputChannel.appendLine(`Linker: ${basename(ldPath)}`);
        outputChannel.appendLine(
          `Flash: ${memoryRegions.flashOrigin} (${formatBytes(flashTotal)})`,
        );
        outputChannel.appendLine(
          `RAM: ${memoryRegions.ramOrigin} (${formatBytes(ramTotal)})`,
        );
      } else {
        outputChannel.appendLine("");
        outputChannel.appendLine(
          "Tip: Add LD_SCRIPT to xmake.lua to see memory percentages",
        );
        outputChannel.appendLine(
          '     Example: local LD_SCRIPT = "STM32F103XB_FLASH.ld"',
        );
      }
    } catch (error) {
      outputChannel.appendLine("");
      outputChannel.appendLine(
        `Error analyzing ${basename(elfPath)}: ${getErrorMessage(error)}`,
      );
    }
  }
}
