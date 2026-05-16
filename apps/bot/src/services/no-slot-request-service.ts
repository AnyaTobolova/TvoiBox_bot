import { InlineKeyboard } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import { NoSlotRequestsApiService } from "./no-slot-requests-api-service";
import { SlotsApiService } from "./slots-api-service";

type NoSlotStep = "awaiting_dates" | "awaiting_times";

interface DateOption {
  key: string;
  label: string;
}

interface TimeOption {
  key: string;
  label: string;
}

interface NoSlotState {
  step: NoSlotStep;
  dateOptions: DateOption[];
  timeOptions: TimeOption[];
  selectedDateKeys: string[];
  selectedTimeKeys: string[];
}

interface NoSlotRequestServiceDependencies {
  apiBaseUrl: string;
  logger: LoggerLike;
  trainerTelegramId: string;
  adminTelegramId: string;
}

interface ReplyLikeContext {
  from?: { id?: number; username?: string };
  reply(text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
  editMessageText?(text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
  answerCallbackQuery?(options?: { text?: string; show_alert?: boolean }): Promise<unknown>;
  callbackQuery?: { data: string };
  api?: {
    sendMessage(chatId: string, text: string, options?: { reply_markup?: InlineKeyboard }): Promise<unknown>;
    deleteMessage(chatId: string, messageId: number): Promise<unknown>;
  };
}

interface HandleResult {
  handled: boolean;
}

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});

const clientAfterRequestKeyboard = new InlineKeyboard()
  .text("Записаться", "screen:client-booking")
  .row()
  .text("Открыть меню", "screen:client-main");

export class NoSlotRequestService {
  private readonly states = new Map<number, NoSlotState>();
  private readonly apiService: NoSlotRequestsApiService;
  private readonly slotsApiService: SlotsApiService;
  private readonly logger: LoggerLike;
  private readonly recipients: string[];
  private readonly lastAdminNoticeMessageIdByChatId = new Map<string, number>();

  constructor(dependencies: NoSlotRequestServiceDependencies) {
    this.apiService = new NoSlotRequestsApiService(dependencies.apiBaseUrl);
    this.slotsApiService = new SlotsApiService(dependencies.apiBaseUrl);
    this.logger = dependencies.logger;
    this.recipients = Array.from(
      new Set([dependencies.trainerTelegramId, dependencies.adminTelegramId].filter(Boolean)),
    );
  }

  async handleCallback(context: ReplyLikeContext): Promise<HandleResult> {
    const callbackData = context.callbackQuery?.data;
    const userId = context.from?.id;

    if (!callbackData || !callbackData.startsWith("noslot:")) {
      return { handled: false };
    }

    if (!userId) {
      return { handled: true };
    }

    if (callbackData === "noslot:start") {
      await this.start(userId, context);
      await context.answerCallbackQuery?.();
      return { handled: true };
    }

    if (callbackData === "noslot:cancel") {
      this.states.delete(userId);
      await context.answerCallbackQuery?.({ text: "Запрос отменён" });
      await this.renderMessage(
        context,
        "Создание запроса отменено.",
        clientAfterRequestKeyboard,
      );
      return { handled: true };
    }

    const state = this.states.get(userId);
    if (!state) {
      await context.answerCallbackQuery?.({
        text: "Сначала откройте запись и нажмите «Нет подходящего времени».",
        show_alert: true,
      });
      return { handled: true };
    }

    if (callbackData.startsWith("noslot:date:")) {
      if (state.step !== "awaiting_dates") {
        await context.answerCallbackQuery?.({ text: "Сейчас выберите время.", show_alert: true });
        return { handled: true };
      }

      const dateKey = callbackData.replace("noslot:date:", "").trim();
      if (!state.dateOptions.some((option) => option.key === dateKey)) {
        await context.answerCallbackQuery?.({ text: "Эта дата больше недоступна.", show_alert: true });
        return { handled: true };
      }

      state.selectedDateKeys = this.toggleSelection(state.selectedDateKeys, dateKey);
      this.states.set(userId, state);

      await context.answerCallbackQuery?.({ text: "Дата обновлена" });
      await this.renderDateStep(context, state);
      return { handled: true };
    }

    if (callbackData === "noslot:dates:next") {
      if (state.step !== "awaiting_dates") {
        await context.answerCallbackQuery?.({ text: "Сейчас выберите время.", show_alert: true });
        return { handled: true };
      }

      if (state.selectedDateKeys.length === 0) {
        await context.answerCallbackQuery?.({
          text: "Сначала выбери хотя бы одну дату.",
          show_alert: true,
        });
        return { handled: true };
      }

      state.step = "awaiting_times";
      this.states.set(userId, state);

      await context.answerCallbackQuery?.({ text: "Переходим ко времени" });
      await this.renderTimeStep(context, state);
      return { handled: true };
    }

    if (callbackData.startsWith("noslot:time:")) {
      if (state.step !== "awaiting_times") {
        await context.answerCallbackQuery?.({ text: "Сначала выберите даты.", show_alert: true });
        return { handled: true };
      }

      const timeKey = callbackData.replace("noslot:time:", "").trim();
      if (!state.timeOptions.some((option) => option.key === timeKey)) {
        await context.answerCallbackQuery?.({ text: "Это время больше недоступно.", show_alert: true });
        return { handled: true };
      }

      state.selectedTimeKeys = this.toggleSelection(state.selectedTimeKeys, timeKey);
      this.states.set(userId, state);

      await context.answerCallbackQuery?.({ text: "Время обновлено" });
      await this.renderTimeStep(context, state);
      return { handled: true };
    }

    if (callbackData === "noslot:times:submit") {
      if (state.step !== "awaiting_times") {
        await context.answerCallbackQuery?.({ text: "Сначала выберите даты.", show_alert: true });
        return { handled: true };
      }

      if (state.selectedTimeKeys.length === 0) {
        await context.answerCallbackQuery?.({
          text: "Сначала выбери хотя бы одно время.",
          show_alert: true,
        });
        return { handled: true };
      }

      await context.answerCallbackQuery?.({ text: "Отправляю запрос" });
      await this.submit(userId, context, state);
      return { handled: true };
    }

    if (callbackData === "noslot:times:back") {
      state.step = "awaiting_dates";
      this.states.set(userId, state);
      await context.answerCallbackQuery?.({ text: "Возвращаю к датам" });
      await this.renderDateStep(context, state);
      return { handled: true };
    }

    return { handled: false };
  }

  async handleText(
    context: { from?: { id?: number; username?: string }; message: { text: string } } & ReplyLikeContext,
  ): Promise<HandleResult> {
    const userId = context.from?.id;
    if (!userId) {
      return { handled: false };
    }

    if (!this.states.has(userId)) {
      return { handled: false };
    }

    await context.reply("Для этого запроса используй кнопки ниже.");
    return { handled: true };
  }

  private async start(userId: number, context: ReplyLikeContext): Promise<void> {
    try {
      const slots = await this.slotsApiService.getAvailableSlots(String(userId));
      const dateOptions = this.buildDateOptions(slots);
      const timeOptions = this.buildTimeOptions(slots);

      if (dateOptions.length === 0 || timeOptions.length === 0) {
        this.states.delete(userId);
        await this.renderMessage(
          context,
          [
            "Нет подходящего времени.",
            "",
            "Сейчас нет открытых дат или времени для выбора.",
            "Попробуй позже или напиши тренеру напрямую.",
          ].join("\n"),
          clientAfterRequestKeyboard,
        );
        return;
      }

      const state: NoSlotState = {
        step: "awaiting_dates",
        dateOptions,
        timeOptions,
        selectedDateKeys: [],
        selectedTimeKeys: [],
      };

      this.states.set(userId, state);
      await this.renderDateStep(context, state);
    } catch (error) {
      const normalizedError = error as Error;
      this.logger.warn("Не удалось открыть сценарий запроса без подходящего времени", {
        userId,
        message: normalizedError.message,
      });

      await this.renderMessage(
        context,
        [
          "Не удалось открыть запрос «Нет подходящего времени».",
          "Проверь, что API и база запущены, и попробуй снова.",
        ].join("\n"),
        clientAfterRequestKeyboard,
      );
    }
  }

  private buildDateOptions(slots: Array<{ startAt: string }>): DateOption[] {
    const unique = new Map<string, DateOption>();

    for (const slot of slots) {
      const start = new Date(slot.startAt);
      const key = this.getDateKey(start);
      if (!unique.has(key)) {
        unique.set(key, {
          key,
          label: dateFormatter.format(start),
        });
      }
    }

    return Array.from(unique.values());
  }

  private buildTimeOptions(slots: Array<{ startAt: string }>): TimeOption[] {
    const unique = new Map<string, TimeOption>();

    for (const slot of slots) {
      const start = new Date(slot.startAt);
      const label = timeFormatter.format(start);
      const key = label.replace(":", "");

      if (!unique.has(key)) {
        unique.set(key, { key, label });
      }
    }

    return Array.from(unique.values()).sort((left, right) => left.label.localeCompare(right.label, "ru-RU"));
  }

  private getDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";

    return `${year}${month}${day}`;
  }

  private toggleSelection(current: string[], key: string): string[] {
    return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
  }

  private getSelectedLabels<T extends { key: string; label: string }>(options: T[], selectedKeys: string[]): string[] {
    return options.filter((option) => selectedKeys.includes(option.key)).map((option) => option.label);
  }

  private async renderDateStep(context: ReplyLikeContext, state: NoSlotState): Promise<void> {
    const selectedDates = this.getSelectedLabels(state.dateOptions, state.selectedDateKeys);

    await this.renderMessage(
      context,
      [
        "Нет подходящего времени.",
        "",
        "Шаг 1: выбери подходящие даты.",
        "Можно выбрать несколько вариантов.",
        selectedDates.length > 0 ? `Выбрано: ${selectedDates.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      this.buildDateKeyboard(state),
    );
  }

  private async renderTimeStep(context: ReplyLikeContext, state: NoSlotState): Promise<void> {
    const selectedDates = this.getSelectedLabels(state.dateOptions, state.selectedDateKeys);
    const selectedTimes = this.getSelectedLabels(state.timeOptions, state.selectedTimeKeys);

    await this.renderMessage(
      context,
      [
        "Нет подходящего времени.",
        "",
        `Даты: ${selectedDates.join(", ")}.`,
        "Шаг 2: выбери подходящее время.",
        "Можно выбрать несколько вариантов.",
        selectedTimes.length > 0 ? `Выбрано: ${selectedTimes.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      this.buildTimeKeyboard(state),
    );
  }

  private buildDateKeyboard(state: NoSlotState): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (let index = 0; index < state.dateOptions.length; index += 2) {
      const row = state.dateOptions.slice(index, index + 2);
      for (const option of row) {
        const isSelected = state.selectedDateKeys.includes(option.key);
        keyboard.text(`${isSelected ? "✅" : "▫️"} ${option.label}`, `noslot:date:${option.key}`);
      }
      keyboard.row();
    }

    keyboard
      .text("Дальше", "noslot:dates:next")
      .row()
      .text("Отменить запрос", "noslot:cancel");

    return keyboard;
  }

  private buildTimeKeyboard(state: NoSlotState): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (let index = 0; index < state.timeOptions.length; index += 2) {
      const row = state.timeOptions.slice(index, index + 2);
      for (const option of row) {
        const isSelected = state.selectedTimeKeys.includes(option.key);
        keyboard.text(`${isSelected ? "✅" : "▫️"} ${option.label}`, `noslot:time:${option.key}`);
      }
      keyboard.row();
    }

    keyboard
      .text("Готово", "noslot:times:submit")
      .row()
      .text("К датам", "noslot:times:back")
      .row()
      .text("Отменить запрос", "noslot:cancel");

    return keyboard;
  }

  private async submit(userId: number, context: ReplyLikeContext, state: NoSlotState): Promise<void> {
    const preferredDays = this.getSelectedLabels(state.dateOptions, state.selectedDateKeys);
    const preferredTimes = this.getSelectedLabels(state.timeOptions, state.selectedTimeKeys);
    let createdRequest:
      | {
          id: string;
          client: {
            telegramId: string;
            fullName: string;
            username: string | null;
            phone: string | null;
          };
          preferredDays: string[];
          preferredTime: string | null;
          clientComment: string | null;
        }
      | null = null;

    try {
      const result = await this.apiService.createRequest({
        telegramId: String(userId),
        preferredDays,
        preferredTime: preferredTimes.join(", "),
        clientComment: null,
      });

      createdRequest = result.request;
      this.states.delete(userId);

      await this.renderMessage(
        context,
        [
          "Запрос отправлен тренеру.",
          `Подходящие даты: ${preferredDays.join(", ")}.`,
          `Подходящее время: ${preferredTimes.join(", ")}.`,
        ].join("\n"),
        clientAfterRequestKeyboard,
      );
    } catch (error) {
      const normalizedError = error as Error;
      this.logger.warn("Не удалось создать запрос без подходящего времени", {
        userId,
        message: normalizedError.message,
      });

      await this.renderMessage(
        context,
        [
          "Не удалось отправить запрос тренеру.",
          "Проверь, что API и база запущены, и попробуй снова.",
        ].join("\n"),
        clientAfterRequestKeyboard,
      );
      return;
    }

    if (!createdRequest) {
      return;
    }

    const username = createdRequest.client.username?.trim()
      ? `@${createdRequest.client.username.trim().replace(/^@/u, "")}`
      : "не указан";
    const trainerText = [
      "Новый запрос без подходящего времени.",
      `Клиент: ${createdRequest.client.fullName}`,
      `Username: ${username}`,
      `Телефон: ${createdRequest.client.phone ?? "не указан"}`,
      `Подходящие даты: ${preferredDays.join(", ")}`,
      `Подходящее время: ${preferredTimes.join(", ")}`,
    ].join("\n");

    let deliveredCount = 0;
    for (const recipient of this.recipients) {
      try {
        await this.sendOrReplaceAdminNotice(context, recipient, trainerText);
        deliveredCount += 1;
      } catch (error) {
        const normalizedError = error as Error;
        this.logger.warn("Не удалось отправить уведомление тренеру о запросе без подходящего времени", {
          userId,
          recipient,
          requestId: createdRequest.id,
          message: normalizedError.message,
        });
      }
    }

    this.logger.info("Создан запрос без подходящего времени", {
      userId,
      requestId: createdRequest.id,
      deliveredNotices: deliveredCount,
    });
  }

  private async renderMessage(
    context: ReplyLikeContext,
    text: string,
    keyboard: InlineKeyboard,
  ): Promise<void> {
    if (typeof context.editMessageText === "function") {
      await context.editMessageText(text, {
        reply_markup: keyboard,
      });
      return;
    }

    await context.reply(text, {
      reply_markup: keyboard,
    });
  }

  private async sendOrReplaceAdminNotice(
    context: ReplyLikeContext,
    chatId: string,
    text: string,
  ): Promise<void> {
    if (!context.api) {
      return;
    }

    const previousMessageId = this.lastAdminNoticeMessageIdByChatId.get(chatId);
    if (previousMessageId) {
      try {
        await context.api.deleteMessage(chatId, previousMessageId);
      } catch {
        // No-op: previous service message could be already deleted manually.
      }
    }

    const sent = await context.api.sendMessage(chatId, text);
    const messageId = (sent as { message_id?: number }).message_id;
    if (typeof messageId === "number") {
      this.lastAdminNoticeMessageIdByChatId.set(chatId, messageId);
    }
  }
}
