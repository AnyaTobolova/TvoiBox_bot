type RuntimeMode = "development" | "test" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";
type BotDeliveryMode = "polling" | "webhook";
const TELEGRAM_ID_PLACEHOLDERS = new Set([
  "123456789",
  "PUT_ADMIN_TELEGRAM_ID_HERE",
  "PUT_TRAINER_TELEGRAM_ID_HERE",
]);

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

function getBooleanEnv(
  name: string,
  fallback: boolean,
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = source[name]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  return value === "true" || value === "1" || value === "yes";
}

function normalizeWebhookPath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error("BOT_WEBHOOK_PATH must not be empty when webhook delivery is enabled");
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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

export interface BotRuntimeConfig {
  adminTelegramId: string;
  apiBaseUrl: string;
  deliveryMode: BotDeliveryMode;
  dryRun: boolean;
  logLevel: LogLevel;
  nodeEnv: RuntimeMode;
  telegramBotToken: string;
  trainerTelegramId: string;
  webhookHost: string;
  webhookPath: string;
  webhookPort: number;
  webhookPublicUrl: string;
  webhookSecretToken: string;
}

export function getBotRuntimeConfig(): BotRuntimeConfig {
  const adminTelegramId = getRequiredEnv("ADMIN_TELEGRAM_ID");
  const deliveryMode = getOptionalEnv("BOT_DELIVERY_MODE", "polling") as BotDeliveryMode;
  const webhookPath = normalizeWebhookPath(
    getOptionalEnv("BOT_WEBHOOK_PATH", "/telegram/webhook"),
  );

  return {
    adminTelegramId,
    apiBaseUrl: getOptionalEnv("API_BASE_URL", "http://localhost:3000"),
    deliveryMode,
    dryRun: getBooleanEnv("BOT_DRY_RUN", true),
    logLevel: getOptionalEnv("BOT_LOG_LEVEL", "debug") as LogLevel,
    nodeEnv: getOptionalEnv("NODE_ENV", "development") as RuntimeMode,
    telegramBotToken: getRequiredEnv("TELEGRAM_BOT_TOKEN"),
    trainerTelegramId: getTelegramIdEnv("TRAINER_TELEGRAM_ID", adminTelegramId),
    webhookHost: getOptionalEnv("BOT_WEBHOOK_HOST", "0.0.0.0"),
    webhookPath,
    webhookPort: getNumberEnv("BOT_WEBHOOK_PORT", 8081),
    webhookPublicUrl: getOptionalEnv("BOT_WEBHOOK_PUBLIC_URL", ""),
    webhookSecretToken: getOptionalEnv("BOT_WEBHOOK_SECRET_TOKEN", ""),
  };
}
