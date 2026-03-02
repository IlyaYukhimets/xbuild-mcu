import { exec } from 'child_process';
import { XmakeConfig, OPTIMIZATION_PRESETS } from './xmakeConfigParser';

/**
 * Error structure from exec commands
 */
export interface ExecError extends Error {
    error: Error;
    stdout: string;
    stderr: string;
    code?: number;
    killed?: boolean;
}

/**
 * Options for exec commands
 */
export interface ExecOptions {
    cwd: string;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
}

/**
 * Promisified version of exec for cleaner async/await usage
 * @param command Command to execute
 * @param options Execution options
 * @returns Promise with stdout and stderr
 */
export function execAsync(
    command: string, 
    options: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const childProcess = exec(
            command, 
            {
                cwd: options.cwd,
                timeout: options.timeout || 120000, // Default 2 minutes
                env: options.env,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            },
            (error, stdout, stderr) => {
                if (error) {
                    const execError = new Error(error.message) as ExecError;
                    execError.error = error;
                    execError.stdout = stdout || '';
                    execError.stderr = stderr || '';
                    execError.code = (error as NodeJS.ErrnoException).code as number | undefined;
                    execError.killed = (error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
                    reject(execError);
                } else {
                    resolve({ stdout: stdout || '', stderr: stderr || '' });
                }
            }
        );
        
        // Handle process errors
        childProcess.on('error', (err: Error) => {
            const execError = new Error(err.message) as ExecError;
            execError.error = err;
            execError.stdout = '';
            execError.stderr = err.message;
            reject(execError);
        });
    });
}

/**
 * Execute a command and return stdout, ignoring errors
 * Useful for commands that may fail but we want to handle gracefully
 */
export function execSilent(command: string, options: ExecOptions): Promise<string> {
    return new Promise((resolve) => {
        exec(
            command,
            {
                cwd: options.cwd,
                timeout: options.timeout || 30000,
                maxBuffer: 5 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                resolve(stdout || stderr || '');
            }
        );
    });
}

/**
 * Validation result interface
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * Validate XmakeConfig data from webview
 * Ensures all required fields exist and have correct types
 */
export function validateXmakeConfig(data: unknown): ValidationResult {
    const errors: string[] = [];
    
    // Check if data is an object
    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['Invalid data: expected an object'] };
    }
    
    const config = data as Record<string, unknown>;
    
    // Required string fields
    const stringFields: (keyof XmakeConfig)[] = [
        'PROJECT_NAME', 'MCU_SERIES', 'MCU_CORE', 'MCU_DEVICE',
        'LD_SCRIPT', 'SVD_FILE', 'JLINK_PATH', 'STM32_SDK',
        'OPTIMIZATION_DEBUG', 'OPTIMIZATION_RELEASE'
    ];
    
    for (const field of stringFields) {
        const value = config[field];
        if (value !== undefined && typeof value !== 'string') {
            errors.push(`Field '${field}' must be a string, got ${typeof value}`);
        }
    }
    
    // Required array fields
    const arrayFields: (keyof XmakeConfig)[] = ['DEFINES', 'INCLUDE_DIRS', 'SOURCE_FILES'];
    
    for (const field of arrayFields) {
        const value = config[field];
        if (value !== undefined) {
            if (!Array.isArray(value)) {
                errors.push(`Field '${field}' must be an array, got ${typeof value}`);
            } else {
                // Check each array item is a string
                for (let i = 0; i < value.length; i++) {
                    if (typeof value[i] !== 'string') {
                        errors.push(`Field '${field}[${i}]' must be a string, got ${typeof value[i]}`);
                    }
                }
            }
        }
    }
    
    // Validate optimization preset IDs
    const validPresetIds = OPTIMIZATION_PRESETS.map(p => p.id);
    if (config.OPTIMIZATION_DEBUG && typeof config.OPTIMIZATION_DEBUG === 'string') {
        if (!validPresetIds.includes(config.OPTIMIZATION_DEBUG)) {
            errors.push(`Invalid OPTIMIZATION_DEBUG preset: ${config.OPTIMIZATION_DEBUG}`);
        }
    }
    if (config.OPTIMIZATION_RELEASE && typeof config.OPTIMIZATION_RELEASE === 'string') {
        if (!validPresetIds.includes(config.OPTIMIZATION_RELEASE)) {
            errors.push(`Invalid OPTIMIZATION_RELEASE preset: ${config.OPTIMIZATION_RELEASE}`);
        }
    }
    
    // Check for potentially dangerous values (basic security check)
    const allStrings = [
        ...stringFields.map(f => config[f] as string),
        ...(Array.isArray(config.DEFINES) ? config.DEFINES as string[] : []),
        ...(Array.isArray(config.INCLUDE_DIRS) ? config.INCLUDE_DIRS as string[] : []),
        ...(Array.isArray(config.SOURCE_FILES) ? config.SOURCE_FILES as string[] : [])
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);
    
    for (const str of allStrings) {
        // Check for command injection attempts
        const dangerousPatterns = [
            /`[^`]*`/,           // Backtick command substitution
            /\$\([^)]*\)/,       // $(...) command substitution
            /\$\{[^}]*\}/,       // ${...} variable expansion that could execute
            /\|\s*\w+/,          // Pipe to another command
            /;\s*\w+/,           // Command separator
            /&&\s*\w+/,          // AND operator
            /\|\|\s*\w+/,        // OR operator
            />\s*\S/,            // Output redirection
            /<\s*\S/             // Input redirection
        ];
        
        for (const pattern of dangerousPatterns) {
            if (pattern.test(str)) {
                errors.push(`Potential command injection detected in value: ${str.substring(0, 50)}...`);
                break;
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Safely convert unknown data to XmakeConfig with defaults for missing fields
 */
export function toXmakeConfig(data: unknown): XmakeConfig {
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
    
    if (!data || typeof data !== 'object') {
        return emptyConfig;
    }
    
    const partial = data as Partial<XmakeConfig>;
    
    // Validate optimization presets
    const validPresetIds = OPTIMIZATION_PRESETS.map(p => p.id);
    const debugPreset = partial.OPTIMIZATION_DEBUG && validPresetIds.includes(partial.OPTIMIZATION_DEBUG) 
        ? partial.OPTIMIZATION_DEBUG 
        : 'debug';
    const releasePreset = partial.OPTIMIZATION_RELEASE && validPresetIds.includes(partial.OPTIMIZATION_RELEASE) 
        ? partial.OPTIMIZATION_RELEASE 
        : 'release';
    
    return {
        PROJECT_NAME: typeof partial.PROJECT_NAME === 'string' ? partial.PROJECT_NAME : '',
        MCU_SERIES: typeof partial.MCU_SERIES === 'string' ? partial.MCU_SERIES : '',
        MCU_CORE: typeof partial.MCU_CORE === 'string' ? partial.MCU_CORE : '',
        MCU_DEVICE: typeof partial.MCU_DEVICE === 'string' ? partial.MCU_DEVICE : '',
        LD_SCRIPT: typeof partial.LD_SCRIPT === 'string' ? partial.LD_SCRIPT : '',
        SVD_FILE: typeof partial.SVD_FILE === 'string' ? partial.SVD_FILE : '',
        JLINK_PATH: typeof partial.JLINK_PATH === 'string' ? partial.JLINK_PATH : '',
        STM32_SDK: typeof partial.STM32_SDK === 'string' ? partial.STM32_SDK : '',
        DEFINES: Array.isArray(partial.DEFINES) ? partial.DEFINES.filter((v): v is string => typeof v === 'string') : [],
        INCLUDE_DIRS: Array.isArray(partial.INCLUDE_DIRS) ? partial.INCLUDE_DIRS.filter((v): v is string => typeof v === 'string') : [],
        SOURCE_FILES: Array.isArray(partial.SOURCE_FILES) ? partial.SOURCE_FILES.filter((v): v is string => typeof v === 'string') : [],
        OPTIMIZATION_DEBUG: debugPreset,
        OPTIMIZATION_RELEASE: releasePreset
    };
}
