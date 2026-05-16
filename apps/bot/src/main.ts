import { createBot } from "./bot";
import { createRuntimeLogger } from "./common/runtime-logger";
import { getBotRuntimeConfig } from "./config/bot-config";

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function bootstrap() {
  const logger = createRuntimeLogger({
    scope: "bot-bootstrap",
    filePath: "../../logs/bot/runtime.jsonl",
    minLevel: "debug",
  });

  try {
    const config = getBotRuntimeConfig();

    logger.info("Bot configuration loaded", {
      adminTelegramId: config.adminTelegramId,
      apiBaseUrl: config.apiBaseUrl,
      nodeEnv: config.nodeEnv,
      dryRun: config.dryRun,
      trainerTelegramId: config.trainerTelegramId,
    });

    logger.info("Telegram bootstrap started", {
      mode: config.dryRun ? "dry-run" : "live",
      note: config.dryRun
        ? "Network interactions are disabled while BOT_DRY_RUN=true."
        : "Live mode enabled: validating token and starting polling.",
    });

    const bot = createBot(config.telegramBotToken, {
      config,
      logger,
    });

    if (config.dryRun) {
      logger.warn("Bot started in dry-run mode", {
        reason: "Safe local startup mode without Telegram network calls.",
      });

      setInterval(() => {
        logger.debug("Bot dry-run heartbeat");
      }, 60_000);

      return;
    }

    const reconnectDelayMs = 15_000;
    let botProfile:
      | {
          id: number;
          username?: string;
          can_join_groups?: boolean;
        }
      | undefined;

    for (;;) {
      try {
        botProfile = await bot.api.getMe();
        break;
      } catch (error) {
        const normalizedError = error as Error;

        logger.error("Telegram token validation failed", {
          message: normalizedError.message,
        });
        logger.warn("Telegram API is temporarily unavailable, retrying", {
          retryInMs: reconnectDelayMs,
        });

        await wait(reconnectDelayMs);
      }
    }

    logger.info("Telegram bot token validated", {
      botId: botProfile?.id ?? null,
      botUsername: botProfile?.username ?? null,
      canJoinGroups: botProfile?.can_join_groups ?? null,
    });

    process.once("SIGINT", () => bot.stop());
    process.once("SIGTERM", () => bot.stop());

    await bot.start({
      onStart: () => {
        logger.info("Bot polling started");
      },
    });
  } catch (error) {
    const normalizedError = error as Error;

    logger.error("Bot bootstrap failed", {
      message: normalizedError.message,
      stack: normalizedError.stack,
    });

    process.exitCode = 1;
  }
}

void bootstrap();
