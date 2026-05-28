import { InlineKeyboard, Keyboard } from "grammy";
import type { Bot, Context } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import type { BotRuntimeConfig } from "../config/bot-config";
import { buildScreenView } from "../menus/main-menu";
import {
  buildClientMiniAppInlineKeyboard,
  getClientMiniAppLabel,
  normalizeMiniAppUrl,
} from "../services/mini-app-entry";
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

function getTrainerMiniAppLabel(config: BotRuntimeConfig) {
  void config;
  return "Открыть тренерский экран";
}

function buildClientMiniAppKeyboard(config: BotRuntimeConfig) {
  return buildClientMiniAppInlineKeyboard(config.miniAppUrl);
}

function buildAdminMiniAppInlineKeyboard(config: BotRuntimeConfig) {
  const trainerMiniAppUrl = normalizeMiniAppUrl(config.miniAppTrainerUrl);

  if (!trainerMiniAppUrl) {
    return null;
  }

  return new InlineKeyboard().webApp(getTrainerMiniAppLabel(config), trainerMiniAppUrl);
}

function buildMiniAppReplyKeyboard(config: BotRuntimeConfig) {
  void config;
  return new Keyboard().text("Старт").resized().persistent();
}

function buildClientWelcomeMessage(config: BotRuntimeConfig, fullName?: string | null) {
  const greeting = fullName?.trim() ? `Привет, ${fullName.trim()}!` : "Привет!";
  const miniAppInlineKeyboard = buildClientMiniAppKeyboard(config);
  const miniAppReplyKeyboard = buildMiniAppReplyKeyboard(config);
  const inlineKeyboard = miniAppInlineKeyboard
    ? miniAppInlineKeyboard.row().text("Меню бота", "screen:client-main")
    : new InlineKeyboard().text("Меню бота", "screen:client-main");

  return {
    welcomeText: [
      greeting,
      "",
      "Это бот клуба Твой Бокс.",
      "Твой Бокс — твой путь к силе и уверенности.",
      "",
      "Здесь можно записаться на индивидуальные тренировки к тренеру Ростиславу, посмотреть свои записи и быстро связаться с тренером по удобному времени.",
    ].join("\n"),
    actionText: miniAppInlineKeyboard
      ? "Нажмите кнопку ниже, чтобы открыть mini app, или «Меню бота», чтобы записаться через бот."
      : "Нажмите «Меню бота», чтобы записаться через бот.",
    inlineKeyboard,
    replyKeyboard: miniAppReplyKeyboard,
  };
}

function buildAdminStartPrompt(config: BotRuntimeConfig) {
  const miniAppInlineKeyboard = buildAdminMiniAppInlineKeyboard(config);
  const miniAppReplyKeyboard = buildMiniAppReplyKeyboard(config);

  return {
    text: miniAppInlineKeyboard
      ? "Тренерский режим. Быстрый вход в mini app — по кнопкам в сообщении ниже. Кнопка «Старт» возвращает в меню бота."
      : "Тренерский режим. Кнопка «Старт» внизу чата возвращает в главное меню.",
    inlineKeyboard: miniAppInlineKeyboard,
    replyKeyboard: miniAppReplyKeyboard,
  };
}

function buildStartMessage(role: UserRole, screenId: ScreenId) {
  if (role === "admin" && screenId === "admin-main") {
    return {
      text: "Выберите раздел ↓",
      keyboard: new InlineKeyboard().text("Заявки", "screen:admin-requests").row().text("Панель админа", "screen:admin-settings"),
    };
  }

  const { text, keyboard } = buildScreenView(screenId, role);
  return { text, keyboard };
}

function buildClientBotMenuMessage(screenId: ScreenId) {
  const { text, keyboard } = buildScreenView(screenId, "client");
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
    const miniAppEnabled = Boolean(dependencies.config.miniAppUrl.trim());
    try {
      const profile = await dependencies.registrationService.syncRegisteredClient(
        userId,
        context.from?.username ?? null,
      );
      const inProgress = dependencies.registrationService.isRegistrationInProgress(userId);

      if (!profile && !miniAppEnabled) {
        await dependencies.registrationService.start(context);
        return;
      }

      clientFullName = profile?.fullName ?? null;

      if (profile && inProgress) {
        dependencies.registrationService.clearRegistrationState(userId);
      }
    } catch (error) {
      const normalizedError = error as Error;

      dependencies.logger.error("Ошибка проверки регистрации клиента", {
        userId,
        message: normalizedError.message,
      });

      await context.reply(
        "Не удалось проверить регистрацию. Проверьте, что API и база запущены, и попробуйте снова.",
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

  if (role === "client" && source === "start-text") {
    const menuMessage = buildClientBotMenuMessage(rootScreen);
    await context.reply(menuMessage.text, {
      reply_markup: menuMessage.keyboard,
    });
    return;
  }

  if (role === "client") {
    const welcome = buildClientWelcomeMessage(dependencies.config, clientFullName);

    await context.reply(welcome.welcomeText, {
      reply_markup: welcome.replyKeyboard,
    });

    await context.reply(welcome.actionText, {
      reply_markup: welcome.inlineKeyboard,
    });

    const menuMessage = buildClientBotMenuMessage(rootScreen);
    await context.reply(menuMessage.text, {
      reply_markup: menuMessage.keyboard,
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
    const inlineKeyboard = buildClientMiniAppKeyboard(dependencies.config);

    if (!inlineKeyboard) {
      await context.reply("Ссылка mini app для этого бота пока не настроена.");
      return;
    }

    await context.reply("Открыть mini app:", {
      reply_markup: inlineKeyboard,
    });
  });

  bot.command("trainerapp", async (context) => {
    const userId = context.from?.id;
    if (!userId || dependencies.resolveRole(userId) !== "admin") {
      await context.reply("Эта команда доступна только тренеру.");
      return;
    }

    const trainerMiniAppUrl = normalizeMiniAppUrl(dependencies.config.miniAppTrainerUrl);

    if (!trainerMiniAppUrl) {
      await context.reply("Ссылка на тренерский экран для этого бота пока не настроена.");
      return;
    }

    await context.reply("Открыть тренерский экран:", {
      reply_markup: {
        inline_keyboard: [[{ text: getTrainerMiniAppLabel(dependencies.config), web_app: { url: trainerMiniAppUrl } }]],
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
