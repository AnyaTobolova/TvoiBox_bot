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

function getDefaultMiniAppUrl(source: NodeJS.ProcessEnv = process.env): string {
  const publicAppDomain = source.PUBLIC_APP_DOMAIN?.trim();

  if (!publicAppDomain) {
    return "";
  }

  const miniAppUrl = /^https?:\/\//iu.test(publicAppDomain)
    ? publicAppDomain
    : `https://${publicAppDomain}`;
  const publicApiDomain = source.PUBLIC_API_DOMAIN?.trim();

  if (!publicApiDomain) {
    return miniAppUrl;
  }

  const apiBaseUrl = /^https?:\/\//iu.test(publicApiDomain)
    ? publicApiDomain
    : `https://${publicApiDomain}`;
  const url = new URL(miniAppUrl);
  url.searchParams.set("apiBaseUrl", apiBaseUrl);
  return url.toString();
}

export interface BotRuntimeConfig {
  adminTelegramId: string;
  apiBaseUrl: string;
  deliveryMode: BotDeliveryMode;
  dryRun: boolean;
  logLevel: LogLevel;
  miniAppLabel: string;
  miniAppTrainerLabel: string;
  miniAppTrainerUrl: string;
  miniAppUrl: string;
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
  const defaultMiniAppUrl = getDefaultMiniAppUrl();

  return {
    adminTelegramId,
    apiBaseUrl: getOptionalEnv("API_BASE_URL", "http://localhost:3000"),
    deliveryMode,
    dryRun: getBooleanEnv("BOT_DRY_RUN", true),
    logLevel: getOptionalEnv("BOT_LOG_LEVEL", "debug") as LogLevel,
    miniAppLabel: getOptionalEnv("BOT_MINI_APP_LABEL", "Открыть mini app"),
    miniAppTrainerLabel: getOptionalEnv("BOT_MINI_APP_TRAINER_LABEL", "Открыть тренерский экран"),
    miniAppTrainerUrl: getOptionalEnv("BOT_MINI_APP_TRAINER_URL", ""),
    miniAppUrl: getOptionalEnv("BOT_MINI_APP_URL", defaultMiniAppUrl),
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
