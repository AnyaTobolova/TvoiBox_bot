import { Injectable } from "@nestjs/common";
import { NoSlotRequestStatus } from "@prisma/client";

import { createRuntimeLogger } from "../../common/logging/runtime-logger";
import { AppConfigService } from "../../config/app-config.service";

const supportTelegramUrl = "https://t.me/RostPV";

const moscowDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface ClientInfo {
  fullName: string;
  telegramId: string;
  username?: string | null;
  phone?: string | null;
}

@Injectable()
export class TelegramNotificationsService {
  private readonly logger = createRuntimeLogger({
    scope: "api-telegram-notifications",
    filePath: "../../logs/api/telegram-notifications.jsonl",
    minLevel: "debug",
  });

  constructor(
    private readonly appConfigService: AppConfigService,
  ) {}

  async notifyTrainerAboutBookingRequest(input: {
    bookingId: string;
    client: ClientInfo;
    startAt: string;
    clientComment?: string | null;
  }) {
    const lines = [
      "Новая заявка из mini app.",
      `Клиент: ${input.client.fullName}`,
      this.buildClientTelegramLine(input.client),
      `Время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.clientComment ? `Комментарий клиента: ${input.clientComment}` : null,
      `Booking ID: ${input.bookingId}`,
    ].filter(Boolean) as string[];

    await this.notifyTrainerRecipients(lines.join("\n"), "trainer-booking-request");
  }

  async notifyTrainerAboutClientRescheduleRequest(input: {
    bookingId: string;
    client: ClientInfo;
    startAt: string;
    clientComment?: string | null;
  }) {
    const lines = [
      "Клиент запросил перенос через mini app.",
      `Клиент: ${input.client.fullName}`,
      this.buildClientTelegramLine(input.client),
      `Запрошенное время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.clientComment ? `Комментарий клиента: ${input.clientComment}` : null,
      `Booking ID: ${input.bookingId}`,
    ].filter(Boolean) as string[];

    await this.notifyTrainerRecipients(lines.join("\n"), "trainer-client-reschedule");
  }

  async notifyTrainerAboutClientCancellation(input: {
    bookingId: string;
    client: ClientInfo;
    startAt: string;
    clientComment?: string | null;
  }) {
    const lines = [
      "Клиент отменил запись через mini app.",
      `Клиент: ${input.client.fullName}`,
      this.buildClientTelegramLine(input.client),
      `Время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.clientComment ? `Комментарий клиента: ${input.clientComment}` : null,
      `Booking ID: ${input.bookingId}`,
    ].filter(Boolean) as string[];

    await this.notifyTrainerRecipients(lines.join("\n"), "trainer-client-cancel");
  }

  async notifyTrainerAboutClientProposalDecision(input: {
    bookingId: string;
    client: ClientInfo;
    startAt: string;
    accepted: boolean;
    decisionNote?: string | null;
  }) {
    const lines = [
      input.accepted
        ? "Клиент принял предложенное время в mini app."
        : "Клиент отклонил предложенное время в mini app.",
      `Клиент: ${input.client.fullName}`,
      this.buildClientTelegramLine(input.client),
      `Актуальное время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.decisionNote ? `Комментарий клиента: ${input.decisionNote}` : null,
      `Booking ID: ${input.bookingId}`,
    ].filter(Boolean) as string[];

    await this.notifyTrainerRecipients(lines.join("\n"), "trainer-client-proposal-decision");
  }

  async notifyTrainerAboutNoSlotRequest(input: {
    requestId: string;
    client: ClientInfo;
    preferredDays: string[];
    preferredTime?: string | null;
    clientComment?: string | null;
  }) {
    const lines = [
      "Новый запрос без слота из mini app.",
      `Клиент: ${input.client.fullName}`,
      this.buildClientTelegramLine(input.client),
      `Предпочтительные дни: ${input.preferredDays.join(", ")}`,
      input.preferredTime ? `Предпочтительное время: ${input.preferredTime}` : null,
      input.clientComment ? `Комментарий клиента: ${input.clientComment}` : null,
      `Request ID: ${input.requestId}`,
    ].filter(Boolean) as string[];

    await this.notifyTrainerRecipients(lines.join("\n"), "trainer-no-slot-request");
  }

  async notifyClientAboutBookingConfirmed(input: {
    bookingId: string;
    clientTelegramId: string;
    startAt: string;
  }) {
    const lines = [
      "Тренер подтвердил запись в mini app.",
      `Время (МСК): ${this.formatDateTime(input.startAt)}`,
      `Booking ID: ${input.bookingId}`,
      `Связь с тренером: ${supportTelegramUrl}`,
    ];

    await this.notifyClient(input.clientTelegramId, lines.join("\n"), "client-booking-confirmed");
  }

  async notifyClientAboutBookingRejected(input: {
    bookingId: string;
    clientTelegramId: string;
    startAt: string;
    trainerComment?: string | null;
  }) {
    const lines = [
      "Тренер отклонил заявку в mini app.",
      `Время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.trainerComment ? `Комментарий тренера: ${input.trainerComment}` : null,
      `Booking ID: ${input.bookingId}`,
      `Связь с тренером: ${supportTelegramUrl}`,
    ].filter(Boolean) as string[];

    await this.notifyClient(input.clientTelegramId, lines.join("\n"), "client-booking-rejected");
  }

  async notifyClientAboutTrainerProposal(input: {
    bookingId: string;
    clientTelegramId: string;
    trainerComment?: string | null;
  }) {
    const lines = [
      "Тренер предложил другое время в mini app.",
      input.trainerComment ? input.trainerComment : null,
      `Booking ID: ${input.bookingId}`,
      `Связь с тренером: ${supportTelegramUrl}`,
    ].filter(Boolean) as string[];

    await this.notifyClient(input.clientTelegramId, lines.join("\n"), "client-trainer-proposal");
  }

  async notifyClientAboutTrainerCancellation(input: {
    bookingId: string;
    clientTelegramId: string;
    startAt: string;
    trainerComment?: string | null;
  }) {
    const lines = [
      "Тренер отменил тренировку в mini app.",
      `Время (МСК): ${this.formatDateTime(input.startAt)}`,
      input.trainerComment ? `Комментарий тренера: ${input.trainerComment}` : null,
      `Booking ID: ${input.bookingId}`,
      `Связь с тренером: ${supportTelegramUrl}`,
    ].filter(Boolean) as string[];

    await this.notifyClient(input.clientTelegramId, lines.join("\n"), "client-trainer-cancel");
  }

  async notifyClientAboutNoSlotRequestUpdate(input: {
    requestId: string;
    clientTelegramId: string;
    status: NoSlotRequestStatus;
    trainerComment?: string | null;
  }) {
    const lines = [
      `Тренер обновил запрос без слота в mini app: ${this.translateNoSlotStatus(input.status)}.`,
      input.trainerComment ? `Комментарий тренера: ${input.trainerComment}` : null,
      `Request ID: ${input.requestId}`,
      `Связь с тренером: ${supportTelegramUrl}`,
    ].filter(Boolean) as string[];

    await this.notifyClient(input.clientTelegramId, lines.join("\n"), "client-no-slot-update");
  }

  private async notifyTrainerRecipients(text: string, reason: string) {
    const recipients = Array.from(new Set([
      this.appConfigService.values.trainerTelegramId,
      this.appConfigService.values.adminTelegramId,
    ].map((item) => item.trim()).filter(Boolean)));

    await Promise.all(recipients.map((chatId) => this.sendMessage(chatId, text, reason)));
  }

  private async notifyClient(chatId: string, text: string, reason: string) {
    await this.sendMessage(chatId.trim(), text, reason);
  }

  private async sendMessage(chatId: string, text: string, reason: string) {
    if (!chatId) {
      this.logger.warn("Telegram notification skipped because chatId is empty", { reason });
      return false;
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.appConfigService.values.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });

      const rawBody = await response.text();
      let payload: unknown = null;
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = rawBody;
        }
      }

      if (!response.ok) {
        this.logger.warn("Telegram notification request failed", {
          reason,
          chatId,
          status: response.status,
          payload,
        });
        return false;
      }

      this.logger.info("Telegram notification sent", {
        reason,
        chatId,
      });
      return true;
    } catch (error) {
      const normalizedError = error as Error;
      this.logger.warn("Telegram notification failed", {
        reason,
        chatId,
        message: normalizedError.message,
      });
      return false;
    }
  }

  private formatDateTime(value: string) {
    return moscowDateTimeFormatter.format(new Date(value));
  }

  private buildClientTelegramLine(client: ClientInfo) {
    if (client.username?.trim()) {
      return `Telegram: @${client.username.trim()}`;
    }

    if (client.phone?.trim()) {
      return `Телефон: ${client.phone.trim()}`;
    }

    return `Telegram ID: ${client.telegramId}`;
  }

  private translateNoSlotStatus(status: NoSlotRequestStatus) {
    switch (status) {
      case NoSlotRequestStatus.NEW:
        return "новый";
      case NoSlotRequestStatus.REVIEWED:
        return "просмотрен";
      case NoSlotRequestStatus.ARCHIVED:
        return "архивирован";
      default:
        return String(status).toLowerCase();
    }
  }
}
