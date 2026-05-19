import { createServer, type Server } from "node:http";

import { createBot } from "./bot";
import { createRuntimeLogger } from "./common/runtime-logger";
import { getBotRuntimeConfig } from "./config/bot-config";
import { webhookCallback } from "grammy";

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
      deliveryMode: config.deliveryMode,
      nodeEnv: config.nodeEnv,
      dryRun: config.dryRun,
      trainerTelegramId: config.trainerTelegramId,
      webhookPath: config.webhookPath,
      webhookPort: config.webhookPort,
      webhookPublicUrl: config.webhookPublicUrl || null,
    });

    logger.info("Telegram bootstrap started", {
      mode: config.dryRun ? "dry-run" : "live",
      note: config.dryRun
        ? "Network interactions are disabled while BOT_DRY_RUN=true."
        : config.deliveryMode === "webhook"
          ? "Live mode enabled: validating token and starting webhook delivery."
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

    let webhookServer: Server | null = null;

    process.once("SIGINT", () => {
      void bot.stop();
      webhookServer?.close();
    });
    process.once("SIGTERM", () => {
      void bot.stop();
      webhookServer?.close();
    });

    if (config.deliveryMode === "webhook") {
      if (!config.webhookPublicUrl) {
        throw new Error(
          "BOT_WEBHOOK_PUBLIC_URL is required when BOT_DELIVERY_MODE=webhook",
        );
      }

      if (!config.webhookSecretToken) {
        throw new Error(
          "BOT_WEBHOOK_SECRET_TOKEN is required when BOT_DELIVERY_MODE=webhook",
        );
      }

      const callback = webhookCallback(bot, "http", {
        secretToken: config.webhookSecretToken,
      });

      webhookServer = createServer(async (request, response) => {
        if (request.url !== config.webhookPath) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        await callback(request, response);
      });

      await new Promise<void>((resolve, reject) => {
        webhookServer!.once("error", reject);
        webhookServer!.listen(config.webhookPort, config.webhookHost, () => {
          webhookServer!.off("error", reject);
          resolve();
        });
      });

      for (;;) {
        try {
          await bot.api.setWebhook(config.webhookPublicUrl, {
            secret_token: config.webhookSecretToken,
          });
          break;
        } catch (error) {
          const normalizedError = error as Error;

          logger.error("Telegram webhook registration failed", {
            message: normalizedError.message,
          });
          logger.warn("Telegram webhook registration will be retried", {
            retryInMs: reconnectDelayMs,
            webhookPublicUrl: config.webhookPublicUrl,
          });

          await wait(reconnectDelayMs);
        }
      }

      logger.info("Bot webhook started", {
        webhookPath: config.webhookPath,
        webhookPort: config.webhookPort,
        webhookPublicUrl: config.webhookPublicUrl,
      });

      await new Promise<void>(() => {
        // Keep the process alive while the HTTP server is running.
      });
      return;
    }

    await bot.api.deleteWebhook();

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
