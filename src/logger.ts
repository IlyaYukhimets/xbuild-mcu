import * as vscode from "vscode";

/**
 * Log levels for the extension, ordered by increasing severity.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARNING = 2,
  ERROR = 3,
}

/**
 * Logger configuration.
 */
interface LoggerConfig {
  level: LogLevel;
  showInOutputChannel: boolean;
  showInConsole: boolean;
}

const LEVEL_CONSOLE_FN: Record<
  LogLevel,
  (message: string, ...args: unknown[]) => void
> = {
  [LogLevel.DEBUG]: console.debug,
  [LogLevel.INFO]: console.info,
  [LogLevel.WARNING]: console.warn,
  [LogLevel.ERROR]: console.error,
};

/**
 * Centralized logging service for the extension.
 *
 * Implemented as a singleton: a single output channel is reused for the
 * whole extension lifetime. Use the exported `logger` instance.
 */
export class Logger implements vscode.Disposable {
  private static instance: Logger | undefined;

  private readonly outputChannel: vscode.OutputChannel;
  private config: LoggerConfig;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Xmake Tools");
    this.config = {
      level: LogLevel.INFO,
      showInOutputChannel: true,
      showInConsole: true,
    };
  }

  /** Get the singleton instance. */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Set the minimum log level. */
  public setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /** Reveal the output channel in VS Code. */
  public show(): void {
    this.outputChannel.show();
  }

  public debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, args);
  }

  public warning(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARNING, message, args);
  }

  public error(message: string, error?: Error | unknown): void {
    this.log(LogLevel.ERROR, message, error ? [error] : []);
  }

  /**
   * Format a single log entry and dispatch it to the configured sinks
   * (VS Code output channel and the developer console).
   */
  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (level < this.config.level) {
      return;
    }

    const prefix = `[${new Date().toISOString()}] [${LogLevel[level]}]`;
    const formattedMessage = `${prefix} ${message}`;
    const argsStr =
      args.length > 0
        ? " " +
          args
            .map((a) =>
              typeof a === "object" ? JSON.stringify(a, null, 2) : String(a),
            )
            .join(" ")
        : "";

    if (this.config.showInOutputChannel) {
      this.outputChannel.appendLine(formattedMessage + argsStr);
    }

    if (this.config.showInConsole) {
      LEVEL_CONSOLE_FN[level](formattedMessage, ...args);
    }
  }

  public dispose(): void {
    this.outputChannel.dispose();
    Logger.instance = undefined;
  }
}

/**
 * Convenience singleton instance used across the extension.
 */
export const logger = Logger.getInstance();
