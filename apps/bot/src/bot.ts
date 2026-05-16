import { Bot, Context, GrammyError, HttpError } from "grammy";

import type { LoggerLike } from "./common/logger-like";
import type { BotRuntimeConfig } from "./config/bot-config";
import { registerNoSlotRequestHandler } from "./handlers/no-slot-request";
import { registerNavigationHandler } from "./handlers/navigation";
import { registerRegistrationHandler } from "./handlers/registration";
import { registerStartHandler } from "./handlers/start";
import { BookingsApiService } from "./services/bookings-api-service";
import { ClientsApiService } from "./services/clients-api-service";
import { NavigationService } from "./services/navigation-service";
import { NoSlotRequestService } from "./services/no-slot-request-service";
import { RegistrationService } from "./services/registration-service";
import { SlotsApiService } from "./services/slots-api-service";
import { TrainerSettingsApiService } from "./services/trainer-settings-api-service";
import type { UserRole } from "./services/screen-service";

function createRoleResolver(config: BotRuntimeConfig) {
  const adminIds = new Set([config.adminTelegramId, config.trainerTelegramId]);

  return (userId: number): UserRole => {
    return adminIds.has(String(userId)) ? "admin" : "client";
  };
}

interface CreateBotDependencies {
  config: BotRuntimeConfig;
  logger: LoggerLike;
}

export function createBot(token: string, dependencies: CreateBotDependencies) {
  const bot = new Bot<Context>(token);
  const navigationService = new NavigationService();
  const resolveRole = createRoleResolver(dependencies.config);
  const registrationService = new RegistrationService({
    apiBaseUrl: dependencies.config.apiBaseUrl,
    logger: dependencies.logger,
    navigationService,
  });
  const slotsApiService = new SlotsApiService(dependencies.config.apiBaseUrl);
  const clientsApiService = new ClientsApiService(
    dependencies.config.apiBaseUrl,
    dependencies.config.trainerTelegramId,
  );
  const trainerSettingsApiService = new TrainerSettingsApiService(
    dependencies.config.apiBaseUrl,
    dependencies.config.trainerTelegramId,
  );
  const bookingsApiService = new BookingsApiService(
    dependencies.config.apiBaseUrl,
    dependencies.config.trainerTelegramId,
  );
  const noSlotRequestService = new NoSlotRequestService({
    apiBaseUrl: dependencies.config.apiBaseUrl,
    logger: dependencies.logger,
    trainerTelegramId: dependencies.config.trainerTelegramId,
    adminTelegramId: dependencies.config.adminTelegramId,
  });

  bot.use(async (context, next) => {
    if (context.message?.text) {
      dependencies.logger.info("Получено сообщение от пользователя", {
        userId: context.from?.id ?? null,
        username: context.from?.username ?? null,
        chatId: context.chat?.id ?? null,
        text: context.message.text,
      });
    }

    if (context.callbackQuery?.data) {
      dependencies.logger.info("Нажата кнопка", {
        userId: context.from?.id ?? null,
        username: context.from?.username ?? null,
        data: context.callbackQuery.data,
      });
    }

    await next();
  });

  registerStartHandler(bot, {
    logger: dependencies.logger,
    navigationService,
    registrationService,
    resolveRole,
  });

  registerRegistrationHandler(bot, {
    registrationService,
    resolveRole,
  });

  registerNoSlotRequestHandler(bot, {
    noSlotRequestService,
  });

  registerNavigationHandler(bot, {
    logger: dependencies.logger,
    navigationService,
    slotsApiService,
    clientsApiService,
    trainerSettingsApiService,
    bookingsApiService,
    registrationService,
    resolveRole,
    trainerTelegramId: dependencies.config.trainerTelegramId,
    adminTelegramId: dependencies.config.adminTelegramId,
  });

  bot.on("message:text", async (context) => {
    if (context.message.text.startsWith("/")) {
      return;
    }

    const registrationResult = await registrationService.handleText(context);

    if (registrationResult.handled) {
      return;
    }

    const noSlotRequestResult = await noSlotRequestService.handleText(context);
    if (noSlotRequestResult.handled) {
      return;
    }

    await context.reply("Не понял сообщение. Нажми кнопку Старт внизу чата или отправь /start.");
  });

  bot.catch(async (errorContext) => {
    const { ctx, error } = errorContext;

    if (error instanceof GrammyError) {
      dependencies.logger.error("Ошибка Telegram API", {
        userId: ctx.from?.id ?? null,
        username: ctx.from?.username ?? null,
        message: error.message,
      });
    } else if (error instanceof HttpError) {
      dependencies.logger.error("Сетевая ошибка Telegram", {
        userId: ctx.from?.id ?? null,
        username: ctx.from?.username ?? null,
        message: error.message,
      });
    } else {
      const normalizedError = error as Error;

      dependencies.logger.error("Необработанная ошибка диалога", {
        userId: ctx.from?.id ?? null,
        username: ctx.from?.username ?? null,
        message: normalizedError.message,
        stack: normalizedError.stack,
      });
    }

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "Произошла ошибка. Попробуй еще раз.",
        show_alert: true,
      });
      return;
    }

    if (ctx.chat) {
      await ctx.reply("Произошла ошибка. Попробуй еще раз позже.");
    }
  });

  return bot;
}

