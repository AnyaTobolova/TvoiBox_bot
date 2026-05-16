import { InlineKeyboard } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import { buildScreenView } from "../menus/main-menu";
import { NavigationService } from "./navigation-service";
import { ClientProfile, ClientsApiService } from "./clients-api-service";
import { UserRole } from "./screen-service";

type RegistrationStep = "awaiting_name" | "awaiting_phone" | "awaiting_consent";

interface RegistrationState {
  fullName?: string;
  phone?: string | null;
  step: RegistrationStep;
  username: string | null;
}

interface RegistrationOutcome {
  handled: boolean;
}

interface RegistrationServiceDependencies {
  apiBaseUrl: string;
  logger: LoggerLike;
  navigationService: NavigationService;
}

const phoneSkipKeyboard = new InlineKeyboard().text("Пропустить телефон", "reg:skip-phone");
const consentKeyboard = new InlineKeyboard()
  .text("Согласен(на)", "reg:consent-accept")
  .row()
  .text("Не согласен(на)", "reg:consent-decline");

export class RegistrationService {
  private readonly states = new Map<number, RegistrationState>();
  private readonly clientsApiService: ClientsApiService;
  private readonly logger: LoggerLike;
  private readonly navigationService: NavigationService;

  constructor(dependencies: RegistrationServiceDependencies) {
    this.clientsApiService = new ClientsApiService(dependencies.apiBaseUrl);
    this.logger = dependencies.logger;
    this.navigationService = dependencies.navigationService;
  }

  isRegistrationInProgress(userId: number): boolean {
    return this.states.has(userId);
  }

  clearRegistrationState(userId: number): void {
    this.states.delete(userId);
  }

  async getRegisteredClient(userId: number): Promise<ClientProfile | null> {
    const result = await this.clientsApiService.findByTelegramId(String(userId));
    return result.found ? result.client ?? null : null;
  }

  async syncRegisteredClient(userId: number, username?: string | null): Promise<ClientProfile | null> {
    const profile = await this.getRegisteredClient(userId);
    if (!profile) {
      return null;
    }

    const normalizedIncomingUsername = username?.trim().replace(/^@/u, "") ?? "";
    const normalizedStoredUsername = profile.username?.trim().replace(/^@/u, "") ?? "";
    if (!normalizedIncomingUsername || normalizedIncomingUsername === normalizedStoredUsername) {
      return profile;
    }

    const result = await this.clientsApiService.register({
      telegramId: String(userId),
      username: normalizedIncomingUsername,
      fullName: profile.fullName,
      phone: profile.phone ?? null,
      consentAccepted: true,
    });

    return result.client;
  }

  async isRegistered(userId: number): Promise<boolean> {
    const profile = await this.getRegisteredClient(userId);
    return profile !== null;
  }

  async start(context: {
    from?: { id?: number; username?: string };
    reply(text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
  }): Promise<void> {
    const userId = context.from?.id;

    if (!userId) {
      return;
    }

    this.states.set(userId, {
      step: "awaiting_name",
      username: context.from?.username ?? null,
    });

    this.logger.info("Старт регистрации", {
      userId,
      username: context.from?.username ?? null,
    });

    await context.reply(
      [
        "Привет! Перед записью нужна регистрация.",
        "Напиши, пожалуйста, имя (можно имя и фамилию).",
      ].join("\n"),
    );
  }

  async handleText(context: {
    from?: { id?: number };
    message: { text: string };
    reply(text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
  }): Promise<RegistrationOutcome> {
    const userId = context.from?.id;

    if (!userId) {
      return { handled: false };
    }

    const state = this.states.get(userId);

    if (!state) {
      return { handled: false };
    }

    const text = context.message.text.trim();

    if (state.step === "awaiting_name") {
      if (text.length < 2) {
        await context.reply("Имя слишком короткое. Напиши минимум 2 символа.");
        return { handled: true };
      }

      state.fullName = text;
      state.step = "awaiting_phone";
      this.states.set(userId, state);

      this.logger.info("Сохранено имя", {
        userId,
        fullName: text,
      });

      await context.reply(
        [
          "Отлично. Теперь укажи телефон в формате +7... или нажми «Пропустить телефон».",
        ].join("\n"),
        {
          reply_markup: phoneSkipKeyboard,
        },
      );

      return { handled: true };
    }

    if (state.step === "awaiting_phone") {
      if (!this.isValidPhone(text)) {
        await context.reply(
          "Не похоже на номер телефона. Введи в формате +7..., или нажми «Пропустить телефон».",
          {
            reply_markup: phoneSkipKeyboard,
          },
        );
        return { handled: true };
      }

      state.phone = text;
      state.step = "awaiting_consent";
      this.states.set(userId, state);

      this.logger.info("Сохранен телефон", {
        userId,
      });

      await context.reply(
        "Подтверди согласие на обработку персональных данных, чтобы продолжить запись.",
        {
          reply_markup: consentKeyboard,
        },
      );

      return { handled: true };
    }

    if (state.step === "awaiting_consent") {
      await context.reply("Нажми кнопку «Согласен(на)» или «Не согласен(на)» под сообщением.");
      return { handled: true };
    }

    return { handled: false };
  }

  async handleCallback(context: {
    callbackQuery: { data: string };
    from?: { id?: number };
    answerCallbackQuery(options?: { text?: string; show_alert?: boolean }): Promise<unknown>;
    reply(text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
  }, resolveRole: (userId: number) => UserRole): Promise<RegistrationOutcome> {
    const userId = context.from?.id;

    if (!userId) {
      return { handled: false };
    }

    const state = this.states.get(userId);
    const callbackData = context.callbackQuery.data;

    if (!callbackData.startsWith("reg:")) {
      return { handled: false };
    }

    if (!state) {
      await context.answerCallbackQuery({
        text: "Регистрация не запущена. Нажми /start.",
        show_alert: true,
      });
      return { handled: true };
    }

    if (callbackData === "reg:skip-phone") {
      if (state.step !== "awaiting_phone") {
        await context.answerCallbackQuery({
          text: "Сейчас этот шаг недоступен.",
          show_alert: true,
        });
        return { handled: true };
      }

      state.phone = null;
      state.step = "awaiting_consent";
      this.states.set(userId, state);

      this.logger.info("Телефон пропущен", {
        userId,
      });

      await context.answerCallbackQuery({
        text: "Телефон пропущен",
      });
      await context.reply(
        "Подтверди согласие на обработку персональных данных, чтобы продолжить запись.",
        {
          reply_markup: consentKeyboard,
        },
      );

      return { handled: true };
    }

    if (callbackData === "reg:consent-decline") {
      await context.answerCallbackQuery({
        text: "Без согласия регистрация невозможна.",
        show_alert: true,
      });
      await context.reply(
        "Без согласия на обработку персональных данных нельзя перейти к записи. Если готов(а) продолжить — нажми «Согласен(на)».",
        {
          reply_markup: consentKeyboard,
        },
      );
      return { handled: true };
    }

    if (callbackData === "reg:consent-accept") {
      if (state.step !== "awaiting_consent" || !state.fullName) {
        await context.answerCallbackQuery({
          text: "Сначала заполни предыдущие шаги регистрации.",
          show_alert: true,
        });
        return { handled: true };
      }

      try {
        await this.clientsApiService.register({
          telegramId: String(userId),
          username: state.username,
          fullName: state.fullName,
          phone: state.phone ?? null,
          consentAccepted: true,
        });

        this.logger.info("Согласие принято", {
          userId,
        });

        this.states.delete(userId);
        const role = resolveRole(userId);
        const rootScreen = this.navigationService.reset(userId, role);
        const view = buildScreenView(rootScreen, role);

        await context.answerCallbackQuery({
          text: "Регистрация завершена",
        });
        await context.reply(
          `Регистрация завершена. Добро пожаловать, ${state.fullName}!`,
        );
        await context.reply(view.text, {
          reply_markup: view.keyboard,
        });
      } catch (error) {
        const normalizedError = error as Error;

        this.logger.error("Ошибка сохранения клиента", {
          userId,
          message: normalizedError.message,
        });

        await context.answerCallbackQuery({
          text: "Не удалось сохранить данные.",
          show_alert: true,
        });
        await context.reply(
          "Не удалось сохранить данные клиента. Проверь, что API и база запущены, и попробуй снова.",
          {
            reply_markup: consentKeyboard,
          },
        );
      }

      return { handled: true };
    }

    return { handled: false };
  }

  private isValidPhone(phone: string): boolean {
    return /^\+?[0-9()\- ]{6,20}$/u.test(phone);
  }
}
