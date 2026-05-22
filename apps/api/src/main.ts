import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { createRuntimeLogger } from "./common/logging/runtime-logger";
import { getApiRuntimeConfig } from "./config/app-config.service";

function maskConnectionString(connectionString: string): string {
  return connectionString.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function bootstrap() {
  const bootstrapLogger = createRuntimeLogger({
    scope: "api-bootstrap",
    filePath: "../../logs/api/runtime.jsonl",
    minLevel: "debug",
  });

  try {
    const config = getApiRuntimeConfig();

    bootstrapLogger.info("API configuration loaded", {
      application: config.name,
      host: config.host,
      port: config.port,
      nodeEnv: config.nodeEnv,
      timezone: config.timezone,
    });

    bootstrapLogger.info("Database bootstrap check", {
      databaseUrl: maskConnectionString(config.databaseUrl),
      note: "Use /health or `corepack pnpm db:runtime-check` for a live connectivity check.",
    });

    const app = await NestFactory.create(AppModule, {
      bufferLogs: false,
    });

    const corsOriginDelegate = (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
        if (!origin || config.miniAppAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    };

    app.enableCors({
      origin: corsOriginDelegate,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });

    await app.listen(config.port, config.host);

    bootstrapLogger.info("API started successfully", {
      url: `http://${config.host}:${config.port}/health`,
    });
  } catch (error) {
    const normalizedError = error as Error;

    bootstrapLogger.error("API bootstrap failed", {
      message: normalizedError.message,
      stack: normalizedError.stack,
    });

    process.exitCode = 1;
  }
}

void bootstrap();
