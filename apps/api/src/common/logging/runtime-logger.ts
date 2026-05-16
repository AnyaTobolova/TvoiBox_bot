import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

const severityOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface RuntimeLoggerOptions {
  filePath: string;
  minLevel?: LogLevel;
  scope: string;
}

export function createRuntimeLogger(options: RuntimeLoggerOptions) {
  const minLevel = options.minLevel ?? "info";
  mkdirSync(dirname(options.filePath), { recursive: true });
  let fileWriteWarningShown = false;

  const write = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (severityOrder[level] < severityOrder[minLevel]) {
      return;
    }

    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: options.scope,
      level,
      message,
      context,
    });

    try {
      appendFileSync(options.filePath, `${record}\n`, { encoding: "utf8" });
    } catch (error) {
      if (!fileWriteWarningShown) {
        fileWriteWarningShown = true;
        const normalizedError = error as Error;
        console.warn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            scope: options.scope,
            level: "warn",
            message: "Runtime log file is unavailable, continuing with console output only",
            context: {
              filePath: options.filePath,
              error: normalizedError.message,
            },
          }),
        );
      }
    }

    if (level === "error") {
      console.error(record);
      return;
    }

    if (level === "warn") {
      console.warn(record);
      return;
    }

    console.log(record);
  };

  return {
    debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
    info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
    warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
    error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
  };
}
