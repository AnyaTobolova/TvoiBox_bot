import { Injectable } from "@nestjs/common";

type RuntimeMode = "development" | "test" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";
type CalendarSyncMode = "real" | "mock";
const TELEGRAM_ID_PLACEHOLDERS = new Set([
  "123456789",
  "PUT_ADMIN_TELEGRAM_ID_HERE",
  "PUT_TRAINER_TELEGRAM_ID_HERE",
]);

const APP_TIMEZONE = "Europe/Moscow";

function getRequiredEnv(name: string, source: NodeJS.ProcessEnv = process.env): string {
  const value = source[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalEnv(
  name: string,
  fallback: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
  return source[name]?.trim() || fallback;
}

function getTelegramIdEnv(
  name: string,
  fallback: string,
  source: NodeJS.ProcessEnv = process.env,
): string {
  const value = source[name]?.trim();

  if (value && !TELEGRAM_ID_PLACEHOLDERS.has(value)) {
    return value;
  }

  return fallback;
}

function getNumberEnv(
  name: string,
  fallback: number,
  source: NodeJS.ProcessEnv = process.env,
): number {
  const rawValue = source[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);

  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a valid number`);
  }

  return parsed;
}

function getStringListEnv(
  name: string,
  fallback: string[],
  source: NodeJS.ProcessEnv = process.env,
): string[] {
  const rawValue = source[name]?.trim();

  if (!rawValue) {
    return fallback;
  }

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface ApiRuntimeConfig {
  name: string;
  host: string;
  port: number;
  databaseUrl: string;
  timezone: string;
  logLevel: LogLevel;
  nodeEnv: RuntimeMode;
  adminTelegramId: string;
  trainerTelegramId: string;
  telegramBotToken: string;
  googleCalendarId: string;
  googleServiceAccountEmail: string;
  googlePrivateKey: string;
  googleServiceAccountJsonPath: string;
  googleCalendarSyncMode: CalendarSyncMode;
  miniAppAuthSecret: string;
  miniAppAllowedOrigins: string[];
  miniAppEnableDevLogin: boolean;
}

export function getApiRuntimeConfig(): ApiRuntimeConfig {
  const adminTelegramId = getRequiredEnv("ADMIN_TELEGRAM_ID");
  const trainerTelegramId = getTelegramIdEnv("TRAINER_TELEGRAM_ID", adminTelegramId);
  const telegramBotToken = getRequiredEnv("TELEGRAM_BOT_TOKEN");
  const publicAppDomain = process.env.PUBLIC_APP_DOMAIN?.trim();
  const defaultMiniAppOrigins = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    ...(publicAppDomain ? [`https://${publicAppDomain}`] : []),
  ];

  return {
    name: getOptionalEnv("APP_NAME", "tvoy-box-training-scheduler"),
    host: getOptionalEnv("APP_HOST", "0.0.0.0"),
    port: getNumberEnv("APP_PORT", 3000),
    databaseUrl: getRequiredEnv("DATABASE_URL"),
    timezone: getOptionalEnv("TZ", APP_TIMEZONE),
    logLevel: getOptionalEnv("API_LOG_LEVEL", "debug") as LogLevel,
    nodeEnv: getOptionalEnv("NODE_ENV", "development") as RuntimeMode,
    adminTelegramId,
    trainerTelegramId,
    telegramBotToken,
    googleCalendarId: getOptionalEnv("GOOGLE_CALENDAR_ID", "primary"),
    googleServiceAccountEmail: getOptionalEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", ""),
    googlePrivateKey: getOptionalEnv("GOOGLE_PRIVATE_KEY", ""),
    googleServiceAccountJsonPath: getOptionalEnv("GOOGLE_SERVICE_ACCOUNT_JSON_PATH", ""),
    googleCalendarSyncMode: getOptionalEnv("GOOGLE_CALENDAR_SYNC_MODE", "real") as CalendarSyncMode,
    miniAppAuthSecret: getOptionalEnv("MINI_APP_AUTH_SECRET", telegramBotToken),
    miniAppAllowedOrigins: getStringListEnv("MINI_APP_ALLOWED_ORIGINS", defaultMiniAppOrigins),
    miniAppEnableDevLogin: getOptionalEnv("MINI_APP_ENABLE_DEV_LOGIN", "false").toLowerCase() === "true",
  };
}

@Injectable()
export class AppConfigService {
  private readonly config = getApiRuntimeConfig();

  get values(): ApiRuntimeConfig {
    return this.config;
  }
}
