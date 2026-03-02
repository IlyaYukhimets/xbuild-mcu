import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

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
 * Parse size string like "20K", "128K", "65536" to bytes
 */
function parseSize(sizeStr: string): number {
    const match = sizeStr.trim().match(/^(\d+(?:\.\d+)?)(K|M)?$/i);
    if (!match) {
        return parseInt(sizeStr, 10) || 0;
    }
    
    const value = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();
    
    if (unit === 'K') {
        return Math.round(value * 1024);
    } else if (unit === 'M') {
        return Math.round(value * 1024 * 1024);
    }
    
    return Math.round(value);
}

/**
 * Parse linker script (.ld) to extract MEMORY region
 */
function parseLinkerScript(ldPath: string): MemoryRegions | null {
    if (!fs.existsSync(ldPath)) {
        return null;
    }
    
    const content = fs.readFileSync(ldPath, 'utf-8');
    
    const memoryMatch = content.match(/MEMORY\s*\{([^}]+)\}/s);
    if (!memoryMatch) {
        return null;
    }
    
    const memoryBlock = memoryMatch[1];
    
    let flash = 0;
    let ram = 0;
    let flashOrigin = '';
    let ramOrigin = '';
    
    const regionRegex = /(\w+)\s*\([^)]*\)\s*:\s*ORIGIN\s*=\s*([^,]+),\s*LENGTH\s*=\s*([^\n\r]+)/gi;
    
    let match;
    while ((match = regionRegex.exec(memoryBlock)) !== null) {
        const name = match[1].toUpperCase();
        const origin = match[2].trim();
        const length = parseSize(match[3].trim());
        
        if (name.includes('FLASH') || name.includes('ROM')) {
            flash = length;
            flashOrigin = origin;
        } else if (name.includes('RAM') || name.includes('SRAM')) {
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
 * Get linker script path from xmake.lua
 */
function getLinkerScriptPath(workspacePath: string): string | null {
    const xmakePath = path.join(workspacePath, 'xmake.lua');
    
    if (!fs.existsSync(xmakePath)) {
        return null;
    }
    
    const content = fs.readFileSync(xmakePath, 'utf-8');
    
    const varMatch = content.match(/local\s+LD_SCRIPT\s*=\s*["']([^"']+)["']/i);
    if (!varMatch) {
        return null;
    }
    
    const ldScript = varMatch[1];
    
    if (path.isAbsolute(ldScript)) {
        return ldScript;
    }
    
    const possiblePaths = [
        path.join(workspacePath, ldScript),
        path.join(workspacePath, 'board', ldScript),
        path.join(workspacePath, 'ld', ldScript),
        path.join(workspacePath, 'linker', ldScript),
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    
    return null;
}

/**
 * Find ELF files in build directory
 */
function findElfFiles(buildDir: string): string[] {
    const elfFiles: string[] = [];
    
    function searchDir(dir: string) {
        if (!fs.existsSync(dir)) {
            return;
        }
        
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                searchDir(fullPath);
            } else if (entry.name.endsWith('.elf')) {
                elfFiles.push(fullPath);
            }
        }
    }
    
    searchDir(buildDir);
    return elfFiles;
}

/**
 * Run arm-none-eabi-size on ELF file
 */
function runSizeCommand(elfPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        exec(`arm-none-eabi-size "${elfPath}"`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Failed to run size: ${stderr || error.message}`));
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * Parse size output
 */
function parseSizeOutput(output: string): MemoryInfo | null {
    const lines = output.trim().split('\n');
    
    for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9a-fA-F]+)\s+(.+)$/);
        if (match) {
            return {
                text: parseInt(match[1], 10),
                data: parseInt(match[2], 10),
                bss: parseInt(match[3], 10),
                dec: parseInt(match[4], 10),
                filename: match[6].trim()
            };
        }
    }
    
    return null;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${bytes}  B`;
}

/**
 * Format percentage
 */
function formatPercent(used: number, total: number): string {
    if (total === 0) {return 'N/A';}
    return `${((used / total) * 100).toFixed(1)}`;
}

/**
 * Right-align string within fixed width
 */
function rightPad(str: string, width: number): string {
    return str.padStart(width);
}

/**
 * Left-align string within fixed width
 */
function leftPad(str: string, width: number): string {
    return str.padEnd(width);
}

/**
 * Analyze memory and print to output channel
 */
export async function showMemoryReport(workspacePath: string): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel('Xmake Memory');
    outputChannel.show(true);
    
    // Find build directory
    const possibleBuildDirs = [
        path.join(workspacePath, 'build'),
        path.join(workspacePath, 'bin'),
        workspacePath
    ];
    
    let elfFiles: string[] = [];
    for (const buildDir of possibleBuildDirs) {
        elfFiles = findElfFiles(buildDir);
        if (elfFiles.length > 0) {
            break;
        }
    }
    
    if (elfFiles.length === 0) {
        outputChannel.appendLine('');
        outputChannel.appendLine('No ELF files found. Build the project first.');
        return;
    }
    
    // Get linker script and parse memory regions
    const ldPath = getLinkerScriptPath(workspacePath);
    const memoryRegions = ldPath ? parseLinkerScript(ldPath) : null;
    
    const flashTotal = memoryRegions?.flash || 0;
    const ramTotal = memoryRegions?.ram || 0;
    
    // Column widths
    const col1 = 22;  // Section
    const col2 = 14;  // Used bytes
    const col3 = 10;  // Used %
    const col4 = 14;  // Remain
    const col5 = 14;  // Total
    
    const line = '+'.padEnd(col1 + 1, '-') + 
                 '+'.padEnd(col2 + 1, '-') + 
                 '+'.padEnd(col3 + 1, '-') + 
                 '+'.padEnd(col4 + 1, '-') + 
                 '+'.padEnd(col5 + 1, '-') + '+';
    
    const headerLine = '+'.padEnd(col1 + col2 + col3 + col4 + col5 + 5, '=') + '+';
    
    for (const elfPath of elfFiles) {
        try {
            const output = await runSizeCommand(elfPath);
            const info = parseSizeOutput(output);
            
            if (info) {
                const flashUsed = info.text + info.data;
                const ramUsed = info.data + info.bss;
                
                const flashRemain = flashTotal ? flashTotal - flashUsed : 0;
                const ramRemain = ramTotal ? ramTotal - ramUsed : 0;
                
                outputChannel.appendLine('');
                outputChannel.appendLine(headerLine);
                outputChannel.appendLine('|' + leftPad('Memory Usage Summary', col1 + col2 + col3 + col4 + col5 + 4) + '|');
                outputChannel.appendLine(headerLine);
                outputChannel.appendLine(line);
                
                // Header
                outputChannel.appendLine(
                    '|' + leftPad('Section', col1) + 
                    '|' + rightPad('Used', col2) + 
                    '|' + rightPad('Use%', col3) + 
                    '|' + rightPad('Remain', col4) + 
                    '|' + rightPad('Total', col5) + '|'
                );
                outputChannel.appendLine(line);
                
                // Flash
                outputChannel.appendLine(
                    '|' + leftPad('Flash', col1) + 
                    '|' + rightPad(formatBytes(flashUsed), col2) + 
                    '|' + rightPad(flashTotal ? formatPercent(flashUsed, flashTotal) : 'N/A', col3) + 
                    '|' + rightPad(flashTotal ? formatBytes(flashRemain) : 'N/A', col4) + 
                    '|' + rightPad(flashTotal ? formatBytes(flashTotal) : 'N/A', col5) + '|'
                );
                outputChannel.appendLine(
                    '|' + leftPad('   .text', col1) + 
                    '|' + rightPad(formatBytes(info.text), col2) + 
                    '|' + rightPad(flashTotal ? formatPercent(info.text, flashTotal) : '', col3) + 
                    '|' + rightPad('', col4) + 
                    '|' + rightPad('', col5) + '|'
                );
                outputChannel.appendLine(
                    '|' + leftPad('   .data', col1) + 
                    '|' + rightPad(formatBytes(info.data), col2) + 
                    '|' + rightPad(flashTotal ? formatPercent(info.data, flashTotal) : '', col3) + 
                    '|' + rightPad('', col4) + 
                    '|' + rightPad('', col5) + '|'
                );
                
                outputChannel.appendLine(line);
                
                // RAM
                outputChannel.appendLine(
                    '|' + leftPad('RAM', col1) + 
                    '|' + rightPad(formatBytes(ramUsed), col2) + 
                    '|' + rightPad(ramTotal ? formatPercent(ramUsed, ramTotal) : 'N/A', col3) + 
                    '|' + rightPad(ramTotal ? formatBytes(ramRemain) : 'N/A', col4) + 
                    '|' + rightPad(ramTotal ? formatBytes(ramTotal) : 'N/A', col5) + '|'
                );
                outputChannel.appendLine(
                    '|' + leftPad('   .data', col1) + 
                    '|' + rightPad(formatBytes(info.data), col2) + 
                    '|' + rightPad(ramTotal ? formatPercent(info.data, ramTotal) : '', col3) + 
                    '|' + rightPad('', col4) + 
                    '|' + rightPad('', col5) + '|'
                );
                outputChannel.appendLine(
                    '|' + leftPad('   .bss', col1) + 
                    '|' + rightPad(formatBytes(info.bss), col2) + 
                    '|' + rightPad(ramTotal ? formatPercent(info.bss, ramTotal) : '', col3) + 
                    '|' + rightPad('', col4) + 
                    '|' + rightPad('', col5) + '|'
                );
                
                outputChannel.appendLine(line);
                outputChannel.appendLine('');
                
                // Summary
                outputChannel.appendLine(`Total image size: ${formatBytes(info.dec)}`);
                outputChannel.appendLine(`File: ${info.filename}`);
                
                if (memoryRegions && ldPath) {
                    outputChannel.appendLine(`Linker: ${path.basename(ldPath)}`);
                    outputChannel.appendLine(`Flash: ${memoryRegions.flashOrigin} (${formatBytes(flashTotal)})`);
                    outputChannel.appendLine(`RAM: ${memoryRegions.ramOrigin} (${formatBytes(ramTotal)})`);
                } else {
                    outputChannel.appendLine('');
                    outputChannel.appendLine('Tip: Add LD_SCRIPT to xmake.lua to see memory percentages');
                    outputChannel.appendLine('     Example: local LD_SCRIPT = "STM32F103XB_FLASH.ld"');
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine('');
            outputChannel.appendLine(`Error analyzing ${path.basename(elfPath)}: ${errorMsg}`);
        }
    }
}
