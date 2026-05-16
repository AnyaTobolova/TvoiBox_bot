import { InlineKeyboard, Keyboard } from "grammy";
import type { Bot, Context } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import { buildScreenView } from "../menus/main-menu";
import { NavigationService } from "../services/navigation-service";
import { RegistrationService } from "../services/registration-service";
import type { ScreenId, UserRole } from "../services/screen-service";

interface StartHandlerDependencies {
  logger: LoggerLike;
  navigationService: NavigationService;
  registrationService: RegistrationService;
  resolveRole(userId: number): UserRole;
}

function buildClientWelcomeMessage(fullName?: string | null) {
  const greeting = fullName?.trim() ? `Привет, ${fullName.trim()}!` : "Привет!";

  return {
    welcomeText: [
      greeting,
      "",
      "Это бот клуба ТвойБокс.",
      "ТвойБокс - твой путь к силе и уверенности.",
      "",
      "Здесь можно записаться на индивидуальные тренировки к тренеру Ростиславу, посмотреть свои записи и быстро связаться с тренером по удобному времени.",
    ].join("\n"),
    actionText: "Нажми кнопку Старт ниже, чтобы открыть меню.",
    inlineKeyboard: new InlineKeyboard().text("Старт", "screen:client-main"),
    replyKeyboard: new Keyboard().text("Старт").resized().persistent(),
  };
}

function buildAdminStartPrompt() {
  return {
    text: "Тренерский режим. Кнопка Старт внизу чата возвращает в главное меню.",
    replyKeyboard: new Keyboard().text("Старт").resized().persistent(),
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
    const welcome = buildClientWelcomeMessage(clientFullName);

    await context.reply(welcome.welcomeText, {
      reply_markup: welcome.replyKeyboard,
    });

    await context.reply(welcome.actionText, {
      reply_markup: welcome.inlineKeyboard,
    });
    return;
  }

  const adminPrompt = buildAdminStartPrompt();
  await context.reply(adminPrompt.text, {
    reply_markup: adminPrompt.replyKeyboard,
  });

  const startMessage = buildStartMessage(role, rootScreen);
  await context.reply(startMessage.text, {
    reply_markup: startMessage.keyboard,
  });
}

export function registerStartHandler(bot: Bot<Context>, dependencies: StartHandlerDependencies) {
  bot.command("start", async (context) => {
    await handleStart(context, dependencies, "/start");
  });

  bot.hears(/^start$/iu, async (context) => {
    await handleStart(context, dependencies, "start-text");
  });

  bot.hears(/^старт$/iu, async (context) => {
    await handleStart(context, dependencies, "start-text");
  });
}
