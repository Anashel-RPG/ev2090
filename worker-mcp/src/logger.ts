/**
 * EV 2090 MCP Server — Structured Logger
 *
 * Session-aware, level-filtered, tool-tagged logging.
 */

import type { LogLevel, LogEntry } from "./types";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private sessionId?: string;

  constructor(level: string = "info", sessionId?: string) {
    this.level = (level as LogLevel) || "info";
    this.sessionId = sessionId;
  }

  withSession(sessionId: string): Logger {
    return new Logger(this.level, sessionId);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private format(
    level: LogLevel,
    message: string,
    tool?: string,
    data?: unknown
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      sessionId: this.sessionId,
      tool,
      message,
      data,
    };
  }

  private output(entry: LogEntry): void {
    const prefix = entry.sessionId
      ? `[${entry.sessionId.slice(0, 8)}]`
      : "";
    const toolTag = entry.tool ? `[${entry.tool}]` : "";
    const msg = `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${prefix}${toolTag} ${entry.message}`;

    switch (entry.level) {
      case "error":
        console.error(msg, entry.data !== undefined ? entry.data : "");
        break;
      case "warn":
        console.warn(msg, entry.data !== undefined ? entry.data : "");
        break;
      case "debug":
        console.debug(msg, entry.data !== undefined ? entry.data : "");
        break;
      default:
        console.log(msg, entry.data !== undefined ? entry.data : "");
    }
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug"))
      this.output(this.format("debug", message, undefined, data));
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info"))
      this.output(this.format("info", message, undefined, data));
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn"))
      this.output(this.format("warn", message, undefined, data));
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog("error"))
      this.output(this.format("error", message, undefined, data));
  }

  tool(toolName: string, message: string, data?: unknown): void {
    if (this.shouldLog("info"))
      this.output(this.format("info", message, toolName, data));
  }

  toolError(toolName: string, message: string, data?: unknown): void {
    if (this.shouldLog("error"))
      this.output(this.format("error", message, toolName, data));
  }

  connect(clientInfo?: string): void {
    this.info(`Client connected${clientInfo ? `: ${clientInfo}` : ""}`);
  }

  disconnect(): void {
    this.info("Client disconnected");
  }

  request(method: string, id: string | number): void {
    this.debug(`Request: ${method} (id: ${id})`);
  }

  response(id: string | number, success: boolean): void {
    this.debug(`Response: id=${id} success=${success}`);
  }
}
