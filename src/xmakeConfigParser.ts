import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a value in Lua function call
 * Can be either a string literal (quoted) or a raw value (variable/expression)
 */
export interface LuaValue {
    value: string;
    isRaw: boolean;  // true if variable/identifier, false if string literal
}

/**
 * Optimization preset definition
 * Based on GCC optimization levels and STM32CubeIDE equivalents
 */
export interface OptimizationPreset {
    id: string;
    name: string;
    description: string;
    cflags: string;      // C compiler flags
    cxxflags: string;    // C++ compiler flags
    debugLevel: number;  // 0-3
    lto: boolean;        // Link Time Optimization
}

/**
 * Available optimization presets
 */
export const OPTIMIZATION_PRESETS: OptimizationPreset[] = [
    {
        id: 'debug',
        name: 'Debug',
        description: 'No optimization, full debug info. Best for initial development.',
        cflags: '-O0',
        cxxflags: '-O0',
        debugLevel: 3,
        lto: false
    },
    {
        id: 'debug-optimized',
        name: 'Debug Optimized (-Og)',
        description: 'Optimized for debugging. Good balance of speed and debug capability.',
        cflags: '-Og',
        cxxflags: '-Og',
        debugLevel: 3,
        lto: false
    },
    {
        id: 'balanced',
        name: 'Balanced (-O1)',
        description: 'Basic optimization with moderate debug info. Good for everyday development.',
        cflags: '-O1',
        cxxflags: '-O1',
        debugLevel: 2,
        lto: false
    },
    {
        id: 'release',
        name: 'Release Size (-Os)',
        description: 'Optimized for size with minimal debug info. Standard release build.',
        cflags: '-Os',
        cxxflags: '-Os',
        debugLevel: 1,
        lto: false
    },
    {
        id: 'speed',
        name: 'Release Speed (-O2)',
        description: 'Optimized for speed with minimal debug info.',
        cflags: '-O2',
        cxxflags: '-O2',
        debugLevel: 1,
        lto: false
    },
    {
        id: 'speed-max',
        name: 'Maximum Speed (-O3)',
        description: 'Maximum speed optimization, no debug info. For production builds.',
        cflags: '-O3',
        cxxflags: '-O3',
        debugLevel: 0,
        lto: false
    },
    {
        id: 'size-max',
        name: 'Maximum Size (-Oz)',
        description: 'Maximum size optimization, no debug info. For constrained flash.',
        cflags: '-Oz',
        cxxflags: '-Oz',
        debugLevel: 0,
        lto: false
    },
    {
        id: 'release-lto',
        name: 'Release with LTO',
        description: 'Size optimization with Link Time Optimization. Best code density.',
        cflags: '-Os',
        cxxflags: '-Os',
        debugLevel: 1,
        lto: true
    }
];

/**
 * Get optimization preset by ID
 */
export function getOptimizationPreset(id: string): OptimizationPreset {
    return OPTIMIZATION_PRESETS.find(p => p.id === id) || OPTIMIZATION_PRESETS[0];
}

export interface XmakeConfig {
    PROJECT_NAME: string;
    MCU_SERIES: string;
    MCU_CORE: string;
    MCU_DEVICE: string;
    LD_SCRIPT: string;
    SVD_FILE: string;
    JLINK_PATH: string;
    STM32_SDK: string;
    DEFINES: string[];
    INCLUDE_DIRS: string[];
    SOURCE_FILES: string[];
    // Optimization settings
    OPTIMIZATION_DEBUG: string;      // Preset ID for debug mode
    OPTIMIZATION_RELEASE: string;    // Preset ID for release mode
}

export class XmakeConfigParser {
    private xmakePath: string;

    constructor(workspacePath: string) {
        this.xmakePath = path.join(workspacePath, 'xmake.lua');
    }

    public exists(): boolean {
        return fs.existsSync(this.xmakePath);
    }

    public read(): XmakeConfig {
        const emptyConfig: XmakeConfig = {
            PROJECT_NAME: '',
            MCU_SERIES: '',
            MCU_CORE: '',
            MCU_DEVICE: '',
            LD_SCRIPT: '',
            SVD_FILE: '',
            JLINK_PATH: '',
            STM32_SDK: '',
            DEFINES: [],
            INCLUDE_DIRS: [],
            SOURCE_FILES: [],
            OPTIMIZATION_DEBUG: 'debug',
            OPTIMIZATION_RELEASE: 'release'
        };

        if (!fs.existsSync(this.xmakePath)) {
            return emptyConfig;
        }

        const content = fs.readFileSync(this.xmakePath, 'utf-8');
        
        return {
            PROJECT_NAME: this.extractVariable(content, 'PROJECT_NAME') || '',
            MCU_SERIES: this.extractVariable(content, 'MCU_SERIES') || '',
            MCU_CORE: this.extractVariable(content, 'MCU_CORE') || '',
            MCU_DEVICE: this.extractVariable(content, 'MCU_DEVICE') || '',
            LD_SCRIPT: this.extractVariable(content, 'LD_SCRIPT') || '',
            SVD_FILE: this.extractVariable(content, 'SVD_FILE') || '',
            JLINK_PATH: this.extractVariable(content, 'JLINK_PATH') || '',
            STM32_SDK: this.extractVariable(content, 'STM32_SDK') || '',
            DEFINES: this.extractArray(content, 'add_defines'),
            INCLUDE_DIRS: this.extractArray(content, 'add_includedirs'),
            SOURCE_FILES: this.extractArray(content, 'add_files'),
            OPTIMIZATION_DEBUG: this.extractVariable(content, 'OPTIMIZATION_DEBUG') || 'debug',
            OPTIMIZATION_RELEASE: this.extractVariable(content, 'OPTIMIZATION_RELEASE') || 'release'
        };
    }

    private extractVariable(content: string, varName: string): string | null {
        const regex = new RegExp(`local\\s+${varName}\\s*=\\s*["']([^"']*)["']`, 'i');
        const match = content.match(regex);
        return match ? match[1] : null;
    }

    /**
     * Extract only string literal values (quoted)
     */
    private extractArray(content: string, funcName: string): string[] {
        const calls = this.findFunctionCalls(content, funcName);
        const results: string[] = [];
        
        for (const call of calls) {
            const args = content.slice(call.argsStart, call.argsEnd);
            // Extract only quoted strings
            const stringRegex = /["']([^"']*)["']/g;
            let strMatch;
            while ((strMatch = stringRegex.exec(args)) !== null) {
                results.push(strMatch[1]);
            }
        }
        
        return results;
    }

    /**
     * Find all function calls with their exact positions
     * Properly handles nested parentheses and strings
     */
    private findFunctionCalls(content: string, funcName: string): Array<{
        start: number;
        end: number;
        argsStart: number;
        argsEnd: number;
    }> {
        const calls: Array<{
            start: number;
            end: number;
            argsStart: number;
            argsEnd: number;
        }> = [];

        const escapedFuncName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedFuncName + '\\s*\\(', 'g');
        
        let match;
        while ((match = regex.exec(content)) !== null) {
            const callStart = match.index;
            const argsStart = match.index + match[0].length;
            
            // Find matching closing parenthesis
            let depth = 1;
            let pos = argsStart;
            
            while (depth > 0 && pos < content.length) {
                const char = content[pos];
                if (char === '(') {
                    depth++;
                } else if (char === ')') {
                    depth--;
                } else if (char === '"' || char === "'") {
                    // Skip string content
                    const quote = char;
                    pos++;
                    while (pos < content.length && content[pos] !== quote) {
                        if (content[pos] === '\\' && pos + 1 < content.length) {
                            pos++;
                        }
                        pos++;
                    }
                } else if (char === '-' && pos + 1 < content.length && content[pos + 1] === '-') {
                    // Skip line comment
                    while (pos < content.length && content[pos] !== '\n') {
                        pos++;
                    }
                }
                pos++;
            }
            
            calls.push({
                start: callStart,
                end: pos,
                argsStart: argsStart,
                argsEnd: pos - 1
            });
        }

        return calls;
    }

    /**
     * Extract raw (unquoted) values from function calls
     */
    private extractRawValuesFromCalls(content: string, calls: Array<{ argsStart: number; argsEnd: number }>): LuaValue[] {
        const results: LuaValue[] = [];
        
        for (const call of calls) {
            const args = content.slice(call.argsStart, call.argsEnd);
            
            // Find all identifiers that are NOT inside quotes
            let inString = false;
            let stringChar = '';
            let currentToken = '';
            
            for (let i = 0; i <= args.length; i++) {
                const char = i < args.length ? args[i] : '';
                
                if (inString) {
                    if (char === stringChar) {
                        inString = false;
                    } else if (char === '\\' && i + 1 < args.length) {
                        i++; // Skip escaped char
                    }
                } else {
                    if (char === '"' || char === "'") {
                        inString = true;
                        stringChar = char;
                        currentToken = '';
                    } else if (/[a-zA-Z_]/.test(char)) {
                        currentToken += char;
                    } else if (/[0-9]/.test(char) && currentToken.length > 0) {
                        currentToken += char;
                    } else {
                        if (currentToken.length > 0) {
                            // Check if it's a valid identifier (not a Lua keyword)
                            const keywords = ['and', 'or', 'not', 'true', 'false', 'nil', 'if', 'then', 'else', 'elseif', 'end', 'for', 'while', 'do', 'repeat', 'until', 'function', 'local', 'return', 'break', 'continue'];
                            if (!keywords.includes(currentToken)) {
                                results.push({ value: currentToken, isRaw: true });
                            }
                        }
                        currentToken = '';
                    }
                }
            }
        }
        
        return results;
    }

    /**
     * Format function call with values
     */
    private formatFunctionCall(funcName: string, values: LuaValue[]): string {
        if (values.length === 0) {
            return `${funcName}()`;
        }

        if (values.length === 1) {
            const v = values[0];
            return v.isRaw ? `${funcName}(${v.value})` : `${funcName}("${v.value}")`;
        }

        const formattedValues = values.map(v => 
            v.isRaw ? `        ${v.value}` : `        "${v.value}"`
        );

        return `${funcName}(\n${formattedValues.join(',\n')}\n    )`;
    }

    /**
     * Add a variable if it doesn't exist in the content
     */
    private ensureVariableExists(content: string, varName: string, defaultValue: string): string {
        const regex = new RegExp(`local\\s+${varName}\\s*=`, 'i');
        if (!regex.test(content)) {
            // Find a good place to insert - after other local variables
            const lastLocalMatch = content.match(/local\s+\w+\s*=\s*["'][^"']*["']/gi);
            if (lastLocalMatch) {
                const lastMatch = lastLocalMatch[lastLocalMatch.length - 1];
                const insertPos = content.indexOf(lastMatch) + lastMatch.length;
                return content.slice(0, insertPos) + `\nlocal ${varName} = "${defaultValue}"` + content.slice(insertPos);
            }
        }
        return content;
    }

    public write(config: XmakeConfig): boolean {
        try {
            let content = fs.readFileSync(this.xmakePath, 'utf-8');
            
            // Ensure optimization variables exist
            content = this.ensureVariableExists(content, 'OPTIMIZATION_DEBUG', config.OPTIMIZATION_DEBUG);
            content = this.ensureVariableExists(content, 'OPTIMIZATION_RELEASE', config.OPTIMIZATION_RELEASE);
            
            // Update variables
            content = this.updateVariable(content, 'PROJECT_NAME', config.PROJECT_NAME);
            content = this.updateVariable(content, 'MCU_SERIES', config.MCU_SERIES);
            content = this.updateVariable(content, 'MCU_CORE', config.MCU_CORE);
            content = this.updateVariable(content, 'MCU_DEVICE', config.MCU_DEVICE);
            content = this.updateVariable(content, 'LD_SCRIPT', config.LD_SCRIPT);
            content = this.updateVariable(content, 'SVD_FILE', config.SVD_FILE);
            content = this.updateVariable(content, 'JLINK_PATH', config.JLINK_PATH);
            content = this.updateVariable(content, 'STM32_SDK', config.STM32_SDK);
            content = this.updateVariable(content, 'OPTIMIZATION_DEBUG', config.OPTIMIZATION_DEBUG);
            content = this.updateVariable(content, 'OPTIMIZATION_RELEASE', config.OPTIMIZATION_RELEASE);
            
            // Update arrays - preserve raw values
            content = this.updateArrayWithRaw(content, 'add_defines', config.DEFINES);
            content = this.updateArrayWithRaw(content, 'add_includedirs', config.INCLUDE_DIRS);
            content = this.updateArrayWithRaw(content, 'add_files', config.SOURCE_FILES);
            
            fs.writeFileSync(this.xmakePath, content, 'utf-8');
            return true;
        } catch (error) {
            console.error('Failed to write xmake.lua:', error);
            return false;
        }
    }

    private updateVariable(content: string, varName: string, value: string): string {
        const regex = new RegExp(`(local\\s+${varName}\\s*=\\s*)["'][^"']*["']`, 'i');
        const replacement = `$1"${value}"`;
        return content.replace(regex, replacement);
    }

    /**
     * Update array function calls while preserving raw (unquoted) values
     */
    private updateArrayWithRaw(
        content: string, 
        funcName: string, 
        stringValues: string[]
    ): string {
        const calls = this.findFunctionCalls(content, funcName);
        
        if (calls.length === 0) {
            return content;
        }

        // Extract existing raw values (variables like MCU_SERIES)
        const existingRaw = this.extractRawValuesFromCalls(content, calls);

        // Combine raw values with new string values
        const allValues: LuaValue[] = [
            ...existingRaw,
            ...stringValues.map(v => ({ value: v, isRaw: false }))
        ];

        // Remove duplicates (keep first occurrence)
        const seen = new Set<string>();
        const uniqueValues = allValues.filter(v => {
            if (seen.has(v.value)) {
                return false;
            }
            seen.add(v.value);
            return true;
        });

        // Format the new function call
        const newCall = this.formatFunctionCall(funcName, uniqueValues);

        // Sort calls by position (first to last)
        const sortedCalls = [...calls].sort((a, b) => a.start - b.start);
        
        // Process calls with offset tracking
        let result = content;
        let offset = 0;

        for (let i = 0; i < sortedCalls.length; i++) {
            const call = sortedCalls[i];
            const adjustedStart = call.start + offset;
            const adjustedEnd = call.end + offset;
            
            if (i === 0) {
                // First call - replace with new content
                result = result.slice(0, adjustedStart) + newCall + result.slice(adjustedEnd);
                offset += newCall.length - (call.end - call.start);
            } else {
                // Other calls - remove them entirely
                // Check if there's a newline before this call to remove it too
                const beforeStart = Math.max(0, adjustedStart - 2);
                const before = result.slice(beforeStart, adjustedStart);
                
                if (before.includes('\n')) {
                    // Remove from the newline
                    const newlinePos = before.lastIndexOf('\n');
                    result = result.slice(0, beforeStart + newlinePos) + result.slice(adjustedEnd);
                    offset += (beforeStart + newlinePos) - adjustedEnd;
                } else {
                    // Just remove the call
                    result = result.slice(0, adjustedStart) + result.slice(adjustedEnd);
                    offset -= (call.end - call.start);
                }
            }
        }

        return result;
    }
}
