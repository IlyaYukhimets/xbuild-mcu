import * as vscode from 'vscode';

/**
 * Log levels for the extension
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARNING = 2,
    ERROR = 3
}

/**
 * Logger configuration
 */
interface LoggerConfig {
    level: LogLevel;
    showInOutputChannel: boolean;
    showInConsole: boolean;
}

/**
 * Centralized logging service for the extension
 * Provides structured logging with configurable levels
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private config: LoggerConfig;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Xmake Tools');
        this.config = {
            level: LogLevel.INFO,
            showInOutputChannel: true,
            showInConsole: true
        };
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Set the minimum log level
     */
    public setLevel(level: LogLevel): void {
        this.config.level = level;
    }

    /**
     * Set whether to show logs in VS Code output channel
     */
    public setShowInOutputChannel(show: boolean): void {
        this.config.showInOutputChannel = show;
    }

    /**
     * Set whether to show logs in developer console
     */
    public setShowInConsole(show: boolean): void {
        this.config.showInConsole = show;
    }

    /**
     * Show the output channel in VS Code
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * Clear the output channel
     */
    public clear(): void {
        this.outputChannel.clear();
    }

    /**
     * Log a debug message
     */
    public debug(message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, message, args);
    }

    /**
     * Log an info message
     */
    public info(message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, message, args);
    }

    /**
     * Log a warning message
     */
    public warning(message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARNING, message, args);
    }

    /**
     * Log an error message
     */
    public error(message: string, error?: Error | unknown): void {
        const args = error ? [error] : [];
        this.log(LogLevel.ERROR, message, args);
    }

    /**
     * Internal log method
     */
    private log(level: LogLevel, message: string, args: unknown[]): void {
        if (level < this.config.level) {
            return;
        }

        const timestamp = new Date().toISOString();
        const levelName = LogLevel[level];
        const prefix = `[${timestamp}] [${levelName}]`;
        const formattedMessage = `${prefix} ${message}`;
        const argsStr = args.length > 0 ? ' ' + args.map(a => 
            typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
        ).join(' ') : '';

        // Output to VS Code channel
        if (this.config.showInOutputChannel) {
            this.outputChannel.appendLine(formattedMessage + argsStr);
        }

        // Output to console for debugging
        if (this.config.showInConsole) {
            switch (level) {
                case LogLevel.DEBUG:
                    console.debug(formattedMessage, ...args);
                    break;
                case LogLevel.INFO:
                    console.info(formattedMessage, ...args);
                    break;
                case LogLevel.WARNING:
                    console.warn(formattedMessage, ...args);
                    break;
                case LogLevel.ERROR:
                    console.error(formattedMessage, ...args);
                    break;
            }
        }
    }

    /**
     * Dispose the output channel
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }
}

/**
 * Convenience logger instance
 */
export const logger = Logger.getInstance();
