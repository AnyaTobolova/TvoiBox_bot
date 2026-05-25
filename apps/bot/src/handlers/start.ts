import { InlineKeyboard, Keyboard } from "grammy";
import type { Bot, Context } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import type { BotRuntimeConfig } from "../config/bot-config";
import { buildScreenView } from "../menus/main-menu";
import { NavigationService } from "../services/navigation-service";
import { RegistrationService } from "../services/registration-service";
import type { ScreenId, UserRole } from "../services/screen-service";

interface StartHandlerDependencies {
  config: BotRuntimeConfig;
  logger: LoggerLike;
  navigationService: NavigationService;
  registrationService: RegistrationService;
  resolveRole(userId: number): UserRole;
}

function buildMiniAppInlineKeyboard(config: BotRuntimeConfig) {
  const miniAppUrl = config.miniAppUrl.trim();
  const trainerMiniAppUrl = config.miniAppTrainerUrl.trim();

  if (!miniAppUrl) {
    return null;
  }

  return {
    inline_keyboard: [
      [{ text: config.miniAppLabel, web_app: { url: miniAppUrl } }],
      ...(trainerMiniAppUrl
        ? [[{ text: config.miniAppTrainerLabel, web_app: { url: trainerMiniAppUrl } }]]
        : []),
    ],
  };
}

function buildMiniAppReplyKeyboard(config: BotRuntimeConfig) {
  const miniAppUrl = config.miniAppUrl.trim();
  const trainerMiniAppUrl = config.miniAppTrainerUrl.trim();

  if (!miniAppUrl) {
    return null;
  }

  return {
    keyboard: [
      [{ text: config.miniAppLabel, web_app: { url: miniAppUrl } }],
      ...(trainerMiniAppUrl
        ? [[{ text: config.miniAppTrainerLabel, web_app: { url: trainerMiniAppUrl } }]]
        : []),
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function buildClientWelcomeMessage(config: BotRuntimeConfig, fullName?: string | null) {
  const greeting = fullName?.trim() ? `Привет, ${fullName.trim()}!` : "Привет!";
  const miniAppInlineKeyboard = buildMiniAppInlineKeyboard(config);
  const miniAppReplyKeyboard = buildMiniAppReplyKeyboard(config);

  return {
    welcomeText: [
      greeting,
      "",
      "Это бот клуба ТвойБокс.",
      "ТвойБокс - твой путь к силе и уверенности.",
      "",
      "Здесь можно записаться на индивидуальные тренировки к тренеру Ростиславу, посмотреть свои записи и быстро связаться с тренером по удобному времени.",
    ].join("\n"),
    actionText: miniAppInlineKeyboard
      ? "Нажми кнопку mini app ниже, чтобы открыть web-интерфейс, или Старт, чтобы остаться в сценарии бота."
      : "Нажми кнопку Старт ниже, чтобы открыть меню.",
    inlineKeyboard: miniAppInlineKeyboard ?? new InlineKeyboard().text("Старт", "screen:client-main"),
    replyKeyboard: miniAppReplyKeyboard ?? new Keyboard().text("Старт").resized().persistent(),
  };
}

function buildAdminStartPrompt(config: BotRuntimeConfig) {
  const miniAppInlineKeyboard = buildMiniAppInlineKeyboard(config);
  const miniAppReplyKeyboard = buildMiniAppReplyKeyboard(config);

  return {
    text: miniAppReplyKeyboard
      ? "Тренерский режим. Можно открыть mini app кнопкой внизу чата или вернуться в меню бота по кнопке Старт."
      : "Тренерский режим. Кнопка Старт внизу чата возвращает в главное меню.",
    inlineKeyboard: miniAppInlineKeyboard,
    replyKeyboard: miniAppReplyKeyboard ?? new Keyboard().text("Старт").resized().persistent(),
  };
}

function buildStartMessage(role: UserRole, screenId: ScreenId) {
  if (role === "admin" && screenId === "admin-main") {
    return {
      text: "Выберите раздел ↓",
      keyboard: new InlineKeyboard()
        .text("Заявки", "screen:admin-requests")
        .row()
        .text("Панель админа", "screen:admin-settings"),
    };
  }

  const { text, keyboard } = buildScreenView(screenId, role);
  return { text, keyboard };
}

async function handleStart(
  context: Context,
  dependencies: StartHandlerDependencies,
  source: "/start" | "start-text",
) {
  const userId = context.from?.id;

  if (!userId) {
    return;
  }

  const role = dependencies.resolveRole(userId);

  dependencies.logger.info("Открыт стартовый сценарий", {
    userId,
    username: context.from?.username ?? null,
    role,
    source,
  });

  let clientFullName: string | null = null;

  if (role === "client") {
    try {
      const profile = await dependencies.registrationService.syncRegisteredClient(
        userId,
        context.from?.username ?? null,
      );
      const inProgress = dependencies.registrationService.isRegistrationInProgress(userId);

      if (!profile) {
        await dependencies.registrationService.start(context);
        return;
      }

      clientFullName = profile.fullName;

      if (inProgress) {
        dependencies.registrationService.clearRegistrationState(userId);
      }
    } catch (error) {
      const normalizedError = error as Error;

      dependencies.logger.error("Ошибка проверки регистрации клиента", {
        userId,
        message: normalizedError.message,
      });

      await context.reply(
        "Не удалось проверить регистрацию. Проверь, что API и база запущены, и попробуй снова.",
      );
      return;
    }
  }

  const rootScreen = dependencies.navigationService.reset(userId, role);

  dependencies.logger.info("Открыт экран", {
    userId,
    role,
    screenId: rootScreen,
    source,
  });

  if (role === "client") {
    const welcome = buildClientWelcomeMessage(dependencies.config, clientFullName);

    await context.reply(welcome.welcomeText, {
      reply_markup: welcome.replyKeyboard,
    });

    await context.reply(welcome.actionText, {
      reply_markup: welcome.inlineKeyboard,
    });
    return;
  }

  const adminPrompt = buildAdminStartPrompt(dependencies.config);
  await context.reply(adminPrompt.text, {
    reply_markup: adminPrompt.replyKeyboard,
  });

  if (adminPrompt.inlineKeyboard) {
    await context.reply("Быстрый вход в mini app:", {
      reply_markup: adminPrompt.inlineKeyboard,
    });
  }

  const startMessage = buildStartMessage(role, rootScreen);
  await context.reply(startMessage.text, {
    reply_markup: startMessage.keyboard,
  });
}

export function registerStartHandler(bot: Bot<Context>, dependencies: StartHandlerDependencies) {
  bot.command("start", async (context) => {
    await handleStart(context, dependencies, "/start");
  });

  bot.command("miniapp", async (context) => {
    const inlineKeyboard = buildMiniAppInlineKeyboard(dependencies.config);

    if (!inlineKeyboard) {
      await context.reply("Ссылка mini app для этого бота пока не настроена.");
      return;
    }

    await context.reply("Открыть mini app:", {
      reply_markup: inlineKeyboard,
    });
  });

  bot.command("trainerapp", async (context) => {
    const trainerMiniAppUrl = dependencies.config.miniAppTrainerUrl.trim();

    if (!trainerMiniAppUrl) {
      await context.reply("Ссылка на тренерский экран для этого бота пока не настроена.");
      return;
    }

    await context.reply("Открыть тренерский экран:", {
      reply_markup: {
        inline_keyboard: [[{ text: dependencies.config.miniAppTrainerLabel, web_app: { url: trainerMiniAppUrl } }]],
      },
    });
  });

  bot.hears(/^start$/iu, async (context) => {
    await handleStart(context, dependencies, "start-text");
  });

  bot.hears(/^старт$/iu, async (context) => {
    await handleStart(context, dependencies, "start-text");
  });
}
