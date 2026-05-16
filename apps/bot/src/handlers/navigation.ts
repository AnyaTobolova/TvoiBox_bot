import { InlineKeyboard, InputFile } from "grammy";
import type { Bot, Context } from "grammy";

import type { LoggerLike } from "../common/logger-like";
import { buildScreenView } from "../menus/main-menu";
import { BookingsApiService } from "../services/bookings-api-service";
import { ClientsApiService, ClientProfile } from "../services/clients-api-service";
import { NavigationService } from "../services/navigation-service";
import { RegistrationService } from "../services/registration-service";
import { ScreenId, UserRole, canAccessScreen } from "../services/screen-service";
import { AvailableSlot, ClosedPeriodItem, SlotsApiService } from "../services/slots-api-service";
import { TrainerSettingsApiService, TrainerSettingsDto } from "../services/trainer-settings-api-service";

interface NavigationHandlerDependencies {
  logger: LoggerLike;
  navigationService: NavigationService;
  slotsApiService: SlotsApiService;
  clientsApiService: ClientsApiService;
  trainerSettingsApiService: TrainerSettingsApiService;
  bookingsApiService: BookingsApiService;
  registrationService: RegistrationService;
  resolveRole(userId: number): UserRole;
  trainerTelegramId: string;
  adminTelegramId: string;
}

interface ClientBookingView {
  text: string;
  keyboard: InlineKeyboard;
}

interface ClientNoSlotView {
  text: string;
  keyboard: InlineKeyboard;
}

interface ClientTrainingsView {
  text: string;
  keyboard: InlineKeyboard;
}

type BookingDetails = Awaited<ReturnType<BookingsApiService["getBookingDetails"]>>;
type ClientTrainingItem = Awaited<ReturnType<BookingsApiService["getClientTrainings"]>>["items"][number];

interface AdminRequestsView {
  text: string;
  keyboard: InlineKeyboard;
}

interface AdminSlotsView {
  text: string;
  keyboard: InlineKeyboard;
}

interface AdminSettingsView {
  text: string;
  keyboard: InlineKeyboard;
}

interface AdminMainView {
  text: string;
  keyboard: InlineKeyboard;
}

interface AdminBlacklistView {
  text: string;
  keyboard: InlineKeyboard;
}

const slotTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const adminDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const MAX_PROPOSAL_SLOTS_TO_SHOW = 5;
const MOVE_PAGE_SIZE = 8;
const DEFAULT_REJECT_COMMENT = "К сожалению, не могу подтвердить это время. Выберите другой слот.";
const DEFAULT_PROPOSE_COMMENT = "Предлагаю альтернативное время для тренировки.";
const DEFAULT_CANCEL_COMMENT = "Тренировка отменена тренером.";
const DEFAULT_RESCHEDULE_COMMENT = "Тренер перенес тренировку на новое время.";
const DEFAULT_FORCE_CLOSE_COMMENT = "Закрыто тренером вручную.";
const lastClientNoticeMessageIdByChatId = new Map<string, number>();
const lastAdminNoticeMessageIdByChatId = new Map<string, number>();
const adminClientSearchModeUsers = new Set<number>();
type AdminClosePeriodStep = "await_start_date" | "await_end_date" | "await_reason";
interface AdminClosePeriodDraft {
  step: AdminClosePeriodStep;
  startAtIso?: string;
  endAtIso?: string;
}

const adminClosePeriodDraftByUser = new Map<number, AdminClosePeriodDraft>();
const ICS_PRODUCT_ID = "-//Tvoy Box//Training Booking//RU";

const slotDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const slotClockFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});

function getScreenIdFromCallback(data: string): ScreenId {
  return data.replace("screen:", "") as ScreenId;
}

interface DateSlotsGroup {
  dateKey: string;
  dateLabel: string;
  slots: AvailableSlot[];
}

interface PagingResult<T> {
  totalPages: number;
  currentPage: number;
  visibleItems: T[];
}

interface AdminDateSummary {
  dateKey: string;
  label: string;
  openCount: number;
  closedCount: number;
  bookedCount: number;
  totalCount: number;
}

type AdminSlotsRangeStep = "pick_start" | "pick_end" | "pick_action";
interface AdminSlotsRangeDraft {
  step: AdminSlotsRangeStep;
  startDateKey?: string;
  endDateKey?: string;
}

interface AdminSlotsTemplateDraft {
  selectedWeekdays: number[];
  selectedHours: number[];
  hoursPage: number;
}

const CLIENT_GRID_COLUMNS = 2;
const CLIENT_GRID_ROWS = 3;
const CLIENT_GRID_PAGE_SIZE = CLIENT_GRID_COLUMNS * CLIENT_GRID_ROWS;
const ADMIN_SLOTS_GRID_COLUMNS = 2;
const ADMIN_SLOTS_GRID_ROWS = 3;
const ADMIN_SLOTS_GRID_PAGE_SIZE = ADMIN_SLOTS_GRID_COLUMNS * ADMIN_SLOTS_GRID_ROWS;
const ADMIN_VISIBLE_HOUR_START = 6;
const ADMIN_VISIBLE_HOUR_END = 23;
const ADMIN_SLOT_FORCE_CLOSE_REASON = "Закрыто тренером через панель даты и времени.";
const ADMIN_SLOT_TEMPLATE_CLOSE_REASON = "Закрыто по шаблону расписания тренера.";
const adminSlotsRangeDraftByUser = new Map<number, AdminSlotsRangeDraft>();
const adminSlotsTemplateDraftByUser = new Map<number, AdminSlotsTemplateDraft>();

function isAdminVisibleHour(hour: number): boolean {
  return hour >= ADMIN_VISIBLE_HOUR_START && hour <= ADMIN_VISIBLE_HOUR_END;
}

function getAdminVisibleHours(): number[] {
  return Array.from(
    { length: ADMIN_VISIBLE_HOUR_END - ADMIN_VISIBLE_HOUR_START + 1 },
    (_, index) => ADMIN_VISIBLE_HOUR_START + index,
  );
}

function filterAdminVisibleSlots(slots: AvailableSlot[]): AvailableSlot[] {
  return slots.filter((slot) => isAdminVisibleHour(getMoscowHour(new Date(slot.startAt))));
}

function getMoscowDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";

  return { year, month, day };
}

function getMoscowDateKey(date: Date): string {
  const { year, month, day } = getMoscowDateParts(date);
  return `${year}${month}${day}`;
}

function buildDateSlotsGroups(slots: AvailableSlot[]): DateSlotsGroup[] {
  const sortedSlots = [...filterAdminVisibleSlots(slots)].sort((left, right) => {
    return new Date(left.startAt).getTime() - new Date(right.startAt).getTime();
  });
  const grouped = new Map<string, DateSlotsGroup>();

  for (const slot of sortedSlots) {
    const start = new Date(slot.startAt);
    const dateKey = getMoscowDateKey(start);
    const existing = grouped.get(dateKey);

    if (existing) {
      existing.slots.push(slot);
      continue;
    }

    grouped.set(dateKey, {
      dateKey,
      dateLabel: slotDateFormatter.format(start),
      slots: [slot],
    });
  }

  return Array.from(grouped.values());
}

function getPaging<T>(items: T[], page: number, pageSize: number): PagingResult<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = currentPage * pageSize;
  const visibleItems = items.slice(startIndex, startIndex + pageSize);

  return {
    totalPages,
    currentPage,
    visibleItems,
  };
}

function addGridButtons(
  keyboard: InlineKeyboard,
  items: Array<{ label: string; callbackData: string }>,
  columns: number,
): void {
  for (let index = 0; index < items.length; index += columns) {
    const rowItems = items.slice(index, index + columns);
    for (const rowItem of rowItems) {
      keyboard.text(rowItem.label, rowItem.callbackData);
    }
    keyboard.row();
  }
}

function buildClientDateSelectionKeyboard(groups: DateSlotsGroup[], page = 0): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(groups, page, CLIENT_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((group) => ({
      label: group.dateLabel,
      callbackData: `slot:date:${group.dateKey}`,
    })),
    CLIENT_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) {
      keyboard.text("<", `slot:datepage:${paging.currentPage - 1}`);
    }
    if (paging.currentPage < paging.totalPages - 1) {
      keyboard.text(">", `slot:datepage:${paging.currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text("Нет подходящего времени", "noslot:start")
    .row()
    .text("Обновить", "screen:client-booking")
    .row()
    .text("Назад", "nav:back");

  return keyboard;
}

function buildClientTimeSelectionKeyboard(group: DateSlotsGroup, page = 0): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(group.slots, page, CLIENT_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((slot) => {
      const start = new Date(slot.startAt);
      return {
        label: slotClockFormatter.format(start),
        callbackData: `slot:time:${slot.id}`,
      };
    }),
    CLIENT_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) {
      keyboard.text("<", `slot:timepage:${group.dateKey}:${paging.currentPage - 1}`);
    }
    if (paging.currentPage < paging.totalPages - 1) {
      keyboard.text(">", `slot:timepage:${group.dateKey}:${paging.currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text("К датам", "screen:client-booking")
    .row()
    .text("Нет подходящего времени", "noslot:start")
    .row()
    .text("Обновить время", `slot:date:${group.dateKey}`)
    .row()
    .text("Назад", "nav:back");

  return keyboard;
}

function getAdminNotificationRecipients(dependencies: NavigationHandlerDependencies): string[] {
  return Array.from(new Set([dependencies.trainerTelegramId, dependencies.adminTelegramId].filter(Boolean)));
}

function buildClientQuickActionsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Записаться", "screen:client-booking")
    .row()
    .text("Открыть меню", "screen:client-main");
}

function buildClientProposalDecisionKeyboard(bookingId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Согласен(на)", `cli:prop:acc:${bookingId}`)
    .row()
    .text("Не согласен(на)", `cli:prop:dec:${bookingId}`)
    .row()
    .text("Открыть меню", "screen:client-main");
}

async function sendOrReplaceClientNotice(
  api: Context["api"],
  chatId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  const previousMessageId = lastClientNoticeMessageIdByChatId.get(chatId);
  if (previousMessageId) {
    try {
      await api.deleteMessage(chatId, previousMessageId);
    } catch {
      // No-op: previous service message could be already deleted manually.
    }
  }

  const sentMessage = await api.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  lastClientNoticeMessageIdByChatId.set(chatId, sentMessage.message_id);
}

async function sendOrReplaceAdminNotice(
  api: Context["api"],
  chatId: string,
  text: string,
  replyMarkup: InlineKeyboard = new InlineKeyboard().text("В главное меню", "screen:admin-main"),
): Promise<void> {
  const previousMessageId = lastAdminNoticeMessageIdByChatId.get(chatId);
  if (previousMessageId) {
    try {
      await api.deleteMessage(chatId, previousMessageId);
    } catch {
      // No-op: previous service message could be already deleted manually.
    }
  }

  const sentMessage = await api.sendMessage(chatId, text, {
    reply_markup: replyMarkup,
  });
  lastAdminNoticeMessageIdByChatId.set(chatId, sentMessage.message_id);
}

function escapeIcsText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/gu, "\\n");
}

function toIcsUtcDateTime(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function buildClientInviteIcs(booking: Pick<BookingDetails, "id" | "client" | "slot">): string {
  const summary = escapeIcsText(`Тренировка: ${booking.client.fullName}`);
  const normalizedUsername = booking.client.username?.trim().replace(/^@/u, "") ?? "";
  const telegramLink = normalizedUsername ? `https://t.me/${normalizedUsername}` : null;
  const description = escapeIcsText([
    `Клиент: ${booking.client.fullName}`,
    telegramLink ? `Username: @${normalizedUsername}` : "Username: не указан",
    telegramLink ? `Telegram: ${telegramLink}` : `Telegram ID: ${booking.client.telegramId}`,
    "Источник: бот ТвойБокс",
  ].join("\n"));

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`training-${booking.id}@tvoy-box.local`)}`,
    `DTSTAMP:${toIcsUtcDateTime(new Date().toISOString())}`,
    `DTSTART:${toIcsUtcDateTime(booking.slot.startAt)}`,
    `DTEND:${toIcsUtcDateTime(booking.slot.endAt)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText("Напоминание: тренировка через 1 день.")}`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText("Напоминание: тренировка через 1 час.")}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function buildClientInviteFilename(startAt: string): string {
  const date = new Date(startAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");

  return `training-${year}${month}${day}-${hour}${minute}.ics`;
}

async function sendClientCalendarInvite(
  api: Context["api"],
  chatId: string,
  booking: Pick<BookingDetails, "id" | "client" | "slot">,
): Promise<void> {
  const invite = buildClientInviteIcs(booking);
  const inviteFile = new InputFile(Buffer.from(invite, "utf-8"), buildClientInviteFilename(booking.slot.startAt));
  await api.sendDocument(chatId, inviteFile, {
    caption: "Приглашение в календарь. Откройте файл и сохраните событие в удобный календарь.",
  });
}

function parseDateKeyFromCallback(data: string): string | null {
  const raw = data.replace("slot:date:", "").trim();
  if (!/^\d{8}$/u.test(raw)) {
    return null;
  }

  return raw;
}

function parseNonNegativePage(raw: string): number | null {
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseDatePageFromCallback(data: string): number | null {
  const raw = data.replace("slot:datepage:", "");
  return parseNonNegativePage(raw);
}

function parseTimePageFromCallback(data: string): { dateKey: string; page: number } | null {
  const payload = data.replace("slot:timepage:", "").trim();
  const [dateKeyRaw, pageRaw] = payload.split(":");
  if (!dateKeyRaw || !pageRaw || !/^\d{8}$/u.test(dateKeyRaw)) {
    return null;
  }

  const page = parseNonNegativePage(pageRaw);
  if (page === null) {
    return null;
  }

  return {
    dateKey: dateKeyRaw,
    page,
  };
}

interface TrainerSettingsPreset {
  field: "horizon" | "cutoff";
  value: number;
}

function parseTrainerSettingsPresetCallback(data: string): TrainerSettingsPreset | null {
  const payload = data.replace("adm:settings:set:", "").trim();
  const [fieldRaw, valueRaw] = payload.split(":");
  if (!fieldRaw || !valueRaw) {
    return null;
  }

  if (fieldRaw !== "horizon" && fieldRaw !== "cutoff") {
    return null;
  }

  const value = Number(valueRaw);
  if (!Number.isInteger(value)) {
    return null;
  }

  return {
    field: fieldRaw,
    value,
  };
}

function parseBlacklistRemoveCallback(data: string): string | null {
  const clientId = data.replace("adm:blacklist:rm:", "").trim();
  if (!clientId) {
    return null;
  }

  return clientId;
}

function isMessageNotModifiedError(error: Error): boolean {
  return error.message.includes("message is not modified");
}

function getBookingStatusLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Ожидает решения";
    case "CONFIRMED":
      return "Подтверждена";
    case "REJECTED":
      return "Отклонена";
    case "RESCHEDULED":
      return "Предложено другое время";
    case "EXPIRED":
      return "Истекла";
    case "CANCELLED":
      return "Отменена";
    default:
      return status;
  }
}

function getBookingStatusShortLabel(status: string): string {
  switch (status) {
    case "PENDING":
      return "Ожидает";
    case "CONFIRMED":
      return "Подтверждена";
    case "REJECTED":
      return "Отклонена";
    case "RESCHEDULED":
      return "Новое время";
    case "EXPIRED":
      return "Истекла";
    case "CANCELLED":
      return "Отменена";
    default:
      return status;
  }
}

function getBookingStatusBadge(status: string): string {
  switch (status) {
    case "PENDING":
      return "[Ожид.]";
    case "CONFIRMED":
      return "[Подтв.]";
    case "REJECTED":
      return "[Откл.]";
    case "RESCHEDULED":
      return "[Нов.вр.]";
    case "EXPIRED":
      return "[Истек.]";
    case "CANCELLED":
      return "[Отмен.]";
    default:
      return "•";
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildClientMention(booking: BookingDetails): string {
  const username = booking.client.username?.trim() ?? "";
  if (username) {
    const safeUsername = username.replace(/^@/u, "");
    const label = `@${safeUsername}`;
    return `<a href=\"https://t.me/${escapeHtml(safeUsername)}\">${escapeHtml(label)}</a>`;
  }

  return "username не указан";
}

function buildAdminRequestsKeyboard(items: BookingDetails[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const booking of items) {
    const start = new Date(booking.slot.startAt);
    const label = `${getBookingStatusBadge(booking.status)} ${slotTimeFormatter.format(start)} · ${booking.client.fullName}`;
    keyboard.text(label, `adm:req:${booking.id}`).row();
  }

  keyboard
    .text("Обновить список", "adm:requests:refresh")
    .row()
    .text("В главное меню", "screen:admin-main");

  return keyboard;
}

function buildAdminBookingActionsKeyboard(booking: BookingDetails): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const username = booking.client.username?.trim().replace(/^@/u, "") ?? "";
  if (username) {
    keyboard
      .url("Написать клиенту", `https://t.me/${encodeURIComponent(username)}`)
      .row();
  }

  if (booking.status === "PENDING") {
    keyboard
      .text("Подтвердить", `adm:confirm:${booking.id}`)
      .row()
      .text("Отклонить", `adm:reject:${booking.id}`)
      .row()
      .text("Предложить другое время", `adm:propose:${booking.id}`)
      .row();
  }

  if (booking.status === "CONFIRMED") {
    keyboard
      .text("Перенести тренировку", `adm:move:${booking.id}`)
      .row()
      .text("Отменить тренировку", `adm:cancel:${booking.id}`)
      .row();
  }

  if (booking.status === "CONFIRMED") {
    keyboard.text("Пересинхронизировать календарь", `adm:resync:${booking.id}`).row();
  }

  if (booking.status === "RESCHEDULED") {
    keyboard
      .text("Закрыть зависшее предложение", `adm:forceclose:${booking.id}`)
      .row();
  }

  keyboard.text("Удалить заявку", `adm:archive:${booking.id}`).row();

  return keyboard
    .text("К списку заявок", "screen:admin-requests")
    .row()
    .text("В главное меню", "screen:admin-main");
}

function buildProposeSlotsKeyboard(bookingId: string, slots: AvailableSlot[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const slot of slots.slice(0, MAX_PROPOSAL_SLOTS_TO_SHOW)) {
    const start = new Date(slot.startAt);
    keyboard.text(slotTimeFormatter.format(start), `adm:proposepick:${bookingId}:${start.getTime()}`).row();
  }

  keyboard.text("К заявке", `adm:req:${bookingId}`).row().text("К списку заявок", "screen:admin-requests");

  return keyboard;
}

function buildMoveSlotsKeyboard(bookingId: string, slots: AvailableSlot[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(slots.length / MOVE_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = currentPage * MOVE_PAGE_SIZE;
  const visibleSlots = slots.slice(startIndex, startIndex + MOVE_PAGE_SIZE);

  for (const slot of visibleSlots) {
    const start = new Date(slot.startAt);
    keyboard.text(slotTimeFormatter.format(start), `adm:movepick:${bookingId}:${start.getTime()}`).row();
  }

  if (totalPages > 1) {
    if (currentPage > 0) {
      keyboard.text("< Назад", `adm:movepage:${bookingId}:${currentPage - 1}`);
    }
    if (currentPage < totalPages - 1) {
      keyboard.text("Вперед >", `adm:movepage:${bookingId}:${currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard.text("К заявке", `adm:req:${bookingId}`).row().text("К списку заявок", "screen:admin-requests");

  return keyboard;
}

function buildBookingDetailsText(booking: BookingDetails): string {
  const createdText = adminDateTimeFormatter.format(new Date(booking.createdAt));
  const expiresText = adminDateTimeFormatter.format(new Date(booking.expiresAt));

  return [
    "Заявка клиента",
    "",
    `Статус: ${getBookingStatusLabel(booking.status)}`,
    `Клиент: ${escapeHtml(booking.client.fullName)}`,
    `Связь в Telegram: ${buildClientMention(booking)}`,
    `Telegram ID: ${escapeHtml(booking.client.telegramId)}`,
    `Телефон: ${escapeHtml(booking.client.phone ?? "не указан")}`,
    `Создана: ${createdText} (МСК)`,
    `Истекает: ${expiresText} (МСК)`,
    booking.clientComment ? `Комментарий клиента: ${escapeHtml(booking.clientComment)}` : "Комментарий клиента: нет",
    booking.trainerComment ? `Комментарий тренера: ${escapeHtml(booking.trainerComment)}` : "",
    booking.status !== "PENDING" && booking.status !== "CONFIRMED" && booking.status !== "RESCHEDULED"
      ? "Действия недоступны: заявка уже обработана."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getBookingErrorMessage(error: Error): string {
  const message = error.message;

  if (message.includes("Slot is not available")) {
    return "Этот слот уже недоступен. Обнови список и выбери другой.";
  }

  if (message.includes("Slot is outside booking horizon")) {
    return "Этот слот вне горизонта записи. Выбери более близкую дату.";
  }

  if (message.includes("same-day booking cutoff")) {
    return "Запись на сегодня уже закрыта по ограничению времени.";
  }

  if (message.includes("Client is blacklisted")) {
    return "Для вашего профиля запись временно недоступна. Обратитесь к тренеру.";
  }

  if (message.includes("Client is not registered")) {
    return "Сначала нужно завершить регистрацию.";
  }

  if (message.includes("Only confirmed booking can be changed")) {
    return "Эту тренировку уже нельзя изменить.";
  }

  if (message.includes("Cannot change past training")) {
    return "Прошедшую тренировку изменить нельзя.";
  }

  if (message.includes("Target slot is the same as current slot")) {
    return "Это текущее время тренировки. Выберите другой слот.";
  }

  if (message.includes("Target slot is no longer available") || message.includes("Target slot is not available")) {
    return "Выбранный слот уже недоступен. Обновите список и выберите другой.";
  }

  if (message.includes("Training record not found for this booking")) {
    return "Тренировку по этой записи не удалось найти. Обратитесь к тренеру.";
  }

  return "Не удалось отправить заявку. Попробуй снова.";
}

function getAdminActionErrorMessage(error: Error): string {
  const message = error.message;

  if (message.includes("Booking request expired")) {
    return "Заявка уже истекла и не может быть обработана.";
  }

  if (message.includes("Booking is already processed")) {
    return "Эта заявка уже обработана.";
  }

  if (message.includes("Only trainer/admin can manage booking requests")) {
    return "Нет доступа к обработке заявок.";
  }

  if (message.includes("Slot is already booked") || message.includes("Slot is not available for confirmation")) {
    return "Подтвердить заявку не удалось: слот недоступен.";
  }

  if (message.includes("Only confirmed booking can be changed")) {
    return "Эту тренировку уже нельзя изменить.";
  }

  if (message.includes("Target slot is not available")) {
    return "Новый слот недоступен. Выбери другой.";
  }

  if (
    message.includes("Google Calendar")
    || message.includes("Internal server error")
    || message.includes("credentials are not configured")
    || message.includes("Training record not found for this booking")
  ) {
    return "Синхронизация с Google Calendar не выполнена. Проверьте настройки и повторите действие.";
  }

  if (message.includes("Booking cannot be force-closed")) {
    return "Эту заявку сейчас нельзя закрыть вручную.";
  }

  return "Не удалось обработать заявку. Попробуй снова.";
}

function getClientProposalActionErrorMessage(error: Error): string {
  const message = error.message;

  if (message.includes("Booking has no active proposal")) {
    return "Это предложение уже неактуально.";
  }

  if (message.includes("Booking does not belong to this client")) {
    return "Это предложение не относится к вашему профилю.";
  }

  if (message.includes("No proposed time found for this booking")) {
    return "Не удалось найти предложенное время. Попроси тренера отправить новое предложение.";
  }

  if (message.includes("Proposed slot is not available")) {
    return "Предложенный слот уже недоступен. Попроси тренера выбрать другой вариант.";
  }

  if (message.includes("Proposed slot is no longer available")) {
    return "Этот вариант уже заняли. Попроси тренера выбрать другое время.";
  }

  if (message.includes("Slot is outside booking horizon") || message.includes("same-day booking cutoff")) {
    return "Предложенное время уже вне доступных правил записи. Попроси тренера выбрать другой слот.";
  }

  if (message.includes("Proposed time is already in the past")) {
    return "Предложенное время уже прошло. Попроси тренера отправить новое предложение.";
  }

  return "Не удалось обработать ответ по предложенному времени.";
}

function parseBookingIdFromCallback(data: string, prefix: string): string {
  return data.replace(prefix, "").trim();
}

function parseProposePickCallback(data: string): { bookingId: string; proposedStartAt: Date } | null {
  const payload = data.replace("adm:proposepick:", "").trim();
  const [bookingId, startRaw] = payload.split(":");

  if (!bookingId || !startRaw) {
    return null;
  }

  const startEpoch = Number(startRaw);
  if (!Number.isFinite(startEpoch)) {
    return null;
  }

  return {
    bookingId,
    proposedStartAt: new Date(startEpoch),
  };
}

function parseMovePickCallback(data: string): { bookingId: string; newStartAt: Date } | null {
  const payload = data.replace("adm:movepick:", "").trim();
  const [bookingId, startRaw] = payload.split(":");

  if (!bookingId || !startRaw) {
    return null;
  }

  const startEpoch = Number(startRaw);
  if (!Number.isFinite(startEpoch)) {
    return null;
  }

  return {
    bookingId,
    newStartAt: new Date(startEpoch),
  };
}

function parseMovePageCallback(data: string): { bookingId: string; page: number } | null {
  const payload = data.replace("adm:movepage:", "").trim();
  const [bookingId, pageRaw] = payload.split(":");

  if (!bookingId || !pageRaw) {
    return null;
  }

  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return { bookingId, page };
}

function parseClientProposalDecisionCallback(data: string): { bookingId: string; decision: "accept" | "decline" } | null {
  const payload = data.replace("cli:prop:", "").trim();
  const [decisionRaw, bookingId] = payload.split(":");

  if (!decisionRaw || !bookingId) {
    return null;
  }

  if (decisionRaw === "acc") {
    return { bookingId, decision: "accept" };
  }

  if (decisionRaw === "dec") {
    return { bookingId, decision: "decline" };
  }

  return null;
}

function parseClientTrainingBookingId(data: string, prefix: string): string | null {
  const bookingId = data.replace(prefix, "").trim();
  if (!bookingId) {
    return null;
  }

  return bookingId;
}

function parseClientTrainingMoveDatePage(data: string): { bookingId: string; page: number } | null {
  const payload = data.replace("cli:tr:move:datepage:", "").trim();
  const [bookingId, pageRaw] = payload.split(":");
  if (!bookingId || !pageRaw) {
    return null;
  }

  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return { bookingId, page };
}

function parseClientTrainingMoveDate(data: string): { bookingId: string; dateKey: string } | null {
  const payload = data.replace("cli:tr:move:date:", "").trim();
  const [bookingId, dateKey] = payload.split(":");
  if (!bookingId || !dateKey || !/^\d{8}$/u.test(dateKey)) {
    return null;
  }

  return { bookingId, dateKey };
}

function parseClientTrainingMoveTimePage(data: string): { bookingId: string; dateKey: string; page: number } | null {
  const payload = data.replace("cli:tr:move:timepage:", "").trim();
  const [bookingId, dateKey, pageRaw] = payload.split(":");
  if (!bookingId || !dateKey || !pageRaw || !/^\d{8}$/u.test(dateKey)) {
    return null;
  }

  const page = Number(pageRaw);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return { bookingId, dateKey, page };
}

function parseClientTrainingMovePick(data: string): { bookingId: string; startAtMs: number } | null {
  const payload = data.replace("cli:tr:move:pick:", "").trim();
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= payload.length - 1) {
    return null;
  }

  const bookingId = payload.slice(0, separatorIndex).trim();
  const startAtMsRaw = payload.slice(separatorIndex + 1).trim();
  const startAtMs = Number(startAtMsRaw);
  if (!bookingId || !Number.isInteger(startAtMs) || startAtMs <= 0) {
    return null;
  }

  return { bookingId, startAtMs };
}

function getClientTrainingStatusLabel(item: ClientTrainingItem): string {
  if (new Date(item.endAt).getTime() <= Date.now() && item.bookingStatus === "CONFIRMED") {
    return "Проведена";
  }
  if (item.bookingStatus === "CONFIRMED" && item.trainingStatus === "RESCHEDULED") {
    return "Подтверждена (перенесена)";
  }
  return getBookingStatusLabel(item.bookingStatus);
}

function buildClientTrainingsListKeyboard(items: ClientTrainingItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const limit = Math.min(items.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const item = items[index];
    const start = new Date(item.startAt);
    keyboard.text(
      `${getBookingStatusBadge(item.bookingStatus)} ${slotTimeFormatter.format(start)}`,
      `cli:tr:view:${item.bookingId}`,
    ).row();
  }

  keyboard
    .text("Обновить", "cli:tr:refresh")
    .row()
    .text("Записаться", "screen:client-booking")
    .row()
    .text("Назад", "nav:back");
  return keyboard;
}

function buildClientTrainingCardKeyboard(item: ClientTrainingItem): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (item.canCancel) {
    keyboard.text("Отменить тренировку", `cli:tr:cancel:${item.bookingId}`).row();
  }
  if (item.canReschedule) {
    keyboard.text("Перенести тренировку", `cli:tr:move:start:${item.bookingId}`).row();
  }
  if (item.canDelete) {
    keyboard.text("Удалить из списка", `cli:tr:archive:${item.bookingId}`).row();
  }
  keyboard
    .text("К списку тренировок", "screen:client-trainings")
    .row()
    .text("Назад", "nav:back");
  return keyboard;
}

function buildClientTrainingMoveDateKeyboard(bookingId: string, groups: DateSlotsGroup[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(groups, page, CLIENT_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((group) => ({
      label: group.dateLabel,
      callbackData: `cli:tr:move:date:${bookingId}:${group.dateKey}`,
    })),
    CLIENT_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) {
      keyboard.text("<", `cli:tr:move:datepage:${bookingId}:${paging.currentPage - 1}`);
    }
    if (paging.currentPage < paging.totalPages - 1) {
      keyboard.text(">", `cli:tr:move:datepage:${bookingId}:${paging.currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text("К карточке", `cli:tr:view:${bookingId}`)
    .row()
    .text("К списку тренировок", "screen:client-trainings")
    .row()
    .text("Назад", "nav:back");

  return keyboard;
}

function buildClientTrainingMoveTimeKeyboard(
  bookingId: string,
  group: DateSlotsGroup,
  page: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(group.slots, page, CLIENT_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((slot) => ({
      label: slotClockFormatter.format(new Date(slot.startAt)),
      callbackData: `cli:tr:move:pick:${bookingId}:${new Date(slot.startAt).getTime()}`,
    })),
    CLIENT_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) {
      keyboard.text("<", `cli:tr:move:timepage:${bookingId}:${group.dateKey}:${paging.currentPage - 1}`);
    }
    if (paging.currentPage < paging.totalPages - 1) {
      keyboard.text(">", `cli:tr:move:timepage:${bookingId}:${group.dateKey}:${paging.currentPage + 1}`);
    }
    keyboard.row();
  }

  keyboard
    .text("К датам", `cli:tr:move:start:${bookingId}`)
    .row()
    .text("К карточке", `cli:tr:view:${bookingId}`)
    .row()
    .text("Назад", "nav:back");

  return keyboard;
}

async function buildClientTrainingsView(
  userId: number,
  fallbackText: string,
  dependencies: NavigationHandlerDependencies,
): Promise<ClientTrainingsView> {
  try {
    const response = await dependencies.bookingsApiService.getClientTrainings(String(userId));
    const items = response.items;

    if (items.length === 0) {
      return {
        text: [
          "Мои тренировки.",
          "",
          "Список пока пуст.",
          "Когда у вас появятся записи, они отобразятся здесь карточками.",
        ].join("\n"),
        keyboard: new InlineKeyboard()
          .text("Обновить", "cli:tr:refresh")
          .row()
          .text("Записаться", "screen:client-booking")
          .row()
          .text("Назад", "nav:back"),
      };
    }

    return {
      text: [
        "Мои тренировки.",
        "",
        "Откройте нужную запись кнопкой ниже.",
      ]
        .filter(Boolean)
        .join("\n"),
      keyboard: buildClientTrainingsListKeyboard(items),
    };
  } catch (error) {
    const normalizedError = error as Error;
    dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ СЂР°Р·РґРµР» РњРѕРё С‚СЂРµРЅРёСЂРѕРІРєРё", {
      userId,
      message: normalizedError.message,
    });
    return {
      text: [
        fallbackText,
        "",
        "Не удалось загрузить ваши тренировки.",
        "Проверьте, что API запущен, и попробуйте снова.",
      ].join("\n"),
      keyboard: new InlineKeyboard().text("Обновить", "cli:tr:refresh").row().text("Назад", "nav:back"),
    };
  }
}

async function buildClientBookingView(
  userId: number,
  fallbackText: string,
  dependencies: NavigationHandlerDependencies,
  options: { selectedDateKey?: string; datePage?: number; timePage?: number } = {},
): Promise<ClientBookingView> {
  try {
    const slots = await dependencies.slotsApiService.getAvailableSlots(String(userId));
    const visibleSlots = filterAdminVisibleSlots(slots);
    let bookingCutoffHours = 0;
    try {
      const settingsResponse = await dependencies.trainerSettingsApiService.getCurrent();
      bookingCutoffHours = settingsResponse.settings.sameDayBookingCutoff;
    } catch (settingsError) {
      const normalizedSettingsError = settingsError as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РѕРіСЂР°РЅРёС‡РµРЅРёРµ Р·Р°РїРёСЃРё Р·Р°СЂР°РЅРµРµ РґР»СЏ РєР»РёРµРЅС‚Р°", {
        userId,
        message: normalizedSettingsError.message,
      });
    }
    const cutoffHint = buildClientCutoffHintText(bookingCutoffHours);

    if (visibleSlots.length === 0) {
      return {
        text: [
          "Сейчас нет открытых дат для записи.",
          "Попробуй обновить экран позже.",
        ].join("\n"),
        keyboard: new InlineKeyboard()
          .text("Нет подходящего времени", "noslot:start")
          .row()
          .text("Обновить", "screen:client-booking")
          .row()
          .text("Назад", "nav:back"),
      };
    }

    const groups = buildDateSlotsGroups(visibleSlots);
    const datePage = options.datePage ?? 0;
    const selectedDateKey = options.selectedDateKey;
    const timePage = options.timePage ?? 0;

    if (!selectedDateKey) {
      const datePaging = getPaging(groups, datePage, CLIENT_GRID_PAGE_SIZE);
      const cutoffLines = cutoffHint
        ? [
            cutoffHint,
            "",
          ]
        : [];

      return {
        text: [
          ...cutoffLines,
          "Шаг 1: выбери дату.",
        ].join("\n"),
        keyboard: buildClientDateSelectionKeyboard(groups, datePaging.currentPage),
      };
    }

    const selectedGroup = groups.find((group) => group.dateKey === selectedDateKey);
    if (!selectedGroup) {
      return {
        text: [
          "Запись на тренировку.",
          "",
          "Выбранная дата больше недоступна.",
          "Выбери дату заново из обновленного списка.",
        ].join("\n"),
        keyboard: buildClientDateSelectionKeyboard(groups, 0),
      };
    }

    const timePaging = getPaging(selectedGroup.slots, timePage, CLIENT_GRID_PAGE_SIZE);

    const cutoffLines = cutoffHint
      ? [
          cutoffHint,
          "",
        ]
      : [];

    return {
      text: [
        ...cutoffLines,
        `Шаг 1: дата — ${selectedGroup.dateLabel}.`,
        "Шаг 2: выбери время.",
        "Нажми на время кнопкой ниже, чтобы отправить заявку тренеру.",
      ].join("\n"),
      keyboard: buildClientTimeSelectionKeyboard(selectedGroup, timePaging.currentPage),
    };
  } catch (error) {
    const normalizedError = error as Error;

    dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РґРѕСЃС‚СѓРїРЅС‹Рµ СЃР»РѕС‚С‹", {
      userId,
      message: normalizedError.message,
    });

    return {
      text: [
        fallbackText,
        "",
        "Список доступных слотов временно недоступен.",
        "Проверь, что API запущен, и попробуй снова.",
      ].join("\n"),
      keyboard: new InlineKeyboard().text("Обновить", "screen:client-booking").row().text("Назад", "nav:back"),
    };
  }
}

function buildClientNoSlotView(): ClientNoSlotView {
  return {
    text: [
      "Нет подходящего времени.",
      "",
      "Выбери удобные даты и время кнопками ниже, и я передам запрос тренеру.",
    ].join("\n"),
    keyboard: new InlineKeyboard().text("Выбрать даты и время", "noslot:start").row().text("Назад", "nav:back"),
  };
}

async function buildAdminRequestsView(dependencies: NavigationHandlerDependencies): Promise<AdminRequestsView> {
  const pending = await dependencies.bookingsApiService.getPendingBookings();
  const items = pending.items;

  if (items.length === 0) {
    return {
      text: "Заявок пока нет.",
      keyboard: new InlineKeyboard()
        .text("Обновить список", "adm:requests:refresh")
        .row()
        .text("В главное меню", "screen:admin-main"),
    };
  }

  return {
    text: "Выберите заявку ниже.",
    keyboard: buildAdminRequestsKeyboard(items),
  };
}

function parseAdminSlotsDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = dateKey.trim().match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { year, month, day };
}

function getMoscowDayRangeByKey(dateKey: string): { start: Date; end: Date } | null {
  const parsed = parseAdminSlotsDateKey(dateKey);
  if (!parsed) {
    return null;
  }

  const start = getMoscowStartOfDayFromParts(parsed.year, parsed.month, parsed.day);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getMoscowHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

function getMoscowDateLabel(date: Date): string {
  return slotDateFormatter.format(date);
}

function getMoscowWeekdayIndex(date: Date): number {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return shifted.getUTCDay(); // 0=РІСЃ, 1=РїРЅ ... 6=СЃР±
}

function getMoscowHourOfDay(date: Date): number {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return shifted.getUTCHours();
}

function getWeekdayLabel(weekdayIndex: number): string {
  switch (weekdayIndex) {
    case 0:
      return "Вс";
    case 1:
      return "Пн";
    case 2:
      return "Вт";
    case 3:
      return "Ср";
    case 4:
      return "Чт";
    case 5:
      return "Пт";
    case 6:
      return "Сб";
    default:
      return String(weekdayIndex);
  }
}

function compareDateKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function sortRangeKeys(startDateKey: string, endDateKey: string): { startDateKey: string; endDateKey: string } {
  return compareDateKeys(startDateKey, endDateKey) <= 0
    ? { startDateKey, endDateKey }
    : { startDateKey: endDateKey, endDateKey: startDateKey };
}

function getDateLabelByKey(dateKey: string): string {
  const dayRange = getMoscowDayRangeByKey(dateKey);
  if (!dayRange) {
    return dateKey;
  }

  return getMoscowDateLabel(dayRange.start);
}

function buildAdminSlotsDateKeyboard(dateSummaries: AdminDateSummary[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(dateSummaries, page, ADMIN_SLOTS_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((summary) => ({
      label: summary.label,
      callbackData: `adm:slots:date:${summary.dateKey}`,
    })),
    ADMIN_SLOTS_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) keyboard.text('<', `adm:slots:page:${paging.currentPage - 1}`);
    if (paging.currentPage < paging.totalPages - 1) keyboard.text('>', `adm:slots:page:${paging.currentPage + 1}`);
    keyboard.row();
  }

  keyboard
    .text('Шаблон: дни + часы', 'adm:slots:tpl:start')
    .row()
    .text('Массово по диапазону', `adm:slots:range:startmode:${paging.currentPage}`)
    .row()
    .text('Обновить', `adm:slots:page:${paging.currentPage}`)
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');
  return keyboard;
}

function buildAdminSlotsTemplateWeekdaysKeyboard(selectedWeekdays: number[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  const selectedSet = new Set(selectedWeekdays);

  addGridButtons(
    keyboard,
    weekdayOrder.map((weekday) => ({
      label: `${selectedSet.has(weekday) ? "✅" : "▫️"} ${getWeekdayLabel(weekday)}`,
      callbackData: `adm:slots:tpl:wd:${weekday}`,
    })),
    2,
  );

  keyboard
    .text('Выбрать все дни', 'adm:slots:tpl:wd:all')
    .row()
    .text('Очистить дни', 'adm:slots:tpl:wd:none')
    .row()
    .text('Далее: выбрать часы', 'adm:slots:tpl:hours')
    .row()
    .text('Отмена', 'adm:slots:tpl:cancel')
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

function buildAdminSlotsTemplateHoursKeyboard(selectedHours: number[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const hours = getAdminVisibleHours();
  const paging = getPaging(hours, page, 12);
  const selectedSet = new Set(selectedHours);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((hour) => ({
      label: `${selectedSet.has(hour) ? "✅" : "▫️"} ${String(hour).padStart(2, '0')}:00`,
      callbackData: `adm:slots:tpl:hr:${hour}`,
    })),
    2,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) keyboard.text('<', `adm:slots:tpl:hrpage:${paging.currentPage - 1}`);
    if (paging.currentPage < paging.totalPages - 1) keyboard.text('>', `adm:slots:tpl:hrpage:${paging.currentPage + 1}`);
    keyboard.row();
  }

  keyboard
    .text('Выбрать все часы', 'adm:slots:tpl:hr:all')
    .row()
    .text('Очистить часы', 'adm:slots:tpl:hr:none')
    .row()
    .text('Применить шаблон', 'adm:slots:tpl:apply')
    .row()
    .text('Назад к дням', 'adm:slots:tpl:start')
    .row()
    .text('Отмена', 'adm:slots:tpl:cancel')
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

function buildAdminSlotsRangeStartKeyboard(dateSummaries: AdminDateSummary[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const paging = getPaging(dateSummaries, page, ADMIN_SLOTS_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((summary) => ({
      label: summary.label,
      callbackData: `adm:slots:range:startpick:${summary.dateKey}`,
    })),
    ADMIN_SLOTS_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) keyboard.text('<', `adm:slots:range:startpage:${paging.currentPage - 1}`);
    if (paging.currentPage < paging.totalPages - 1) keyboard.text('>', `adm:slots:range:startpage:${paging.currentPage + 1}`);
    keyboard.row();
  }

  keyboard
    .text('Отмена', 'adm:slots:range:cancel')
    .row()
    .text('К датам', `adm:slots:page:${paging.currentPage}`)
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

function buildAdminSlotsRangeEndKeyboard(dateSummaries: AdminDateSummary[], startDateKey: string, page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const allowed = dateSummaries.filter((summary) => compareDateKeys(summary.dateKey, startDateKey) >= 0);
  const paging = getPaging(allowed, page, ADMIN_SLOTS_GRID_PAGE_SIZE);

  addGridButtons(
    keyboard,
    paging.visibleItems.map((summary) => ({
      label: summary.label,
      callbackData: `adm:slots:range:endpick:${summary.dateKey}`,
    })),
    ADMIN_SLOTS_GRID_COLUMNS,
  );

  if (paging.totalPages > 1) {
    if (paging.currentPage > 0) keyboard.text('<', `adm:slots:range:endpage:${paging.currentPage - 1}`);
    if (paging.currentPage < paging.totalPages - 1) keyboard.text('>', `adm:slots:range:endpage:${paging.currentPage + 1}`);
    keyboard.row();
  }

  keyboard
    .text('Изменить дату начала', 'adm:slots:range:restart')
    .row()
    .text('Отмена', 'adm:slots:range:cancel')
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

function buildAdminSlotsRangeActionKeyboard(startDateKey: string, endDateKey: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const range = sortRangeKeys(startDateKey, endDateKey);

  keyboard
    .text('Открыть диапазон', `adm:slots:range:apply:open:${range.startDateKey}:${range.endDateKey}`)
    .row()
    .text('Закрыть диапазон', `adm:slots:range:apply:close:${range.startDateKey}:${range.endDateKey}`)
    .row()
    .text('Изменить даты', 'adm:slots:range:restart')
    .row()
    .text('Отмена', 'adm:slots:range:cancel')
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

function buildAdminDateSummary(dateKey: string, slots: AvailableSlot[]): AdminDateSummary {
  const dayRange = getMoscowDayRangeByKey(dateKey);
  const baseLabel = dayRange ? getMoscowDateLabel(dayRange.start) : dateKey;
  const visibleSlots = filterAdminVisibleSlots(slots);
  const openCount = visibleSlots.filter((slot) => slot.status === 'OPEN').length;
  const closedCount = visibleSlots.filter((slot) => slot.status === 'CLOSED').length;
  const bookedCount = visibleSlots.filter((slot) => slot.status === 'BOOKED').length;
  const totalCount = visibleSlots.length;

  return {
    dateKey,
    label: `${baseLabel} ${openCount}/${totalCount}`,
    openCount,
    closedCount,
    bookedCount,
    totalCount,
  };
}

async function buildAdminSlotsView(
  dependencies: NavigationHandlerDependencies,
  page = 0,
): Promise<AdminSlotsView> {
  const dateSummaries = await getAdminDateSummaries(dependencies);
  const settingsResponse = await dependencies.trainerSettingsApiService.getCurrent();
  const settings = settingsResponse.settings;
  const paging = getPaging(dateSummaries, page, ADMIN_SLOTS_GRID_PAGE_SIZE);

  return {
    text: [
      'Панель админа > Даты и время.',
      '',
      'Шаг 1: выберите дату.',
      `Доступный горизонт: ${settings.bookingHorizonDays} дн.`,
      `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
      '',
      `Показаны рабочие часы: ${String(ADMIN_VISIBLE_HOUR_START).padStart(2, "0")}:00-${String(ADMIN_VISIBLE_HOUR_END).padStart(2, "0")}:00.`,
      'В кнопке даты указаны дата и количество открытых часов из общего числа.',
      `Например: 14.05 4/${ADMIN_VISIBLE_HOUR_END - ADMIN_VISIBLE_HOUR_START + 1} означает, что открыты 4 рабочих часа.`,
    ].join('\n'),
    keyboard: buildAdminSlotsDateKeyboard(dateSummaries, page),
  };
}

async function getAdminDateSummaries(dependencies: NavigationHandlerDependencies): Promise<AdminDateSummary[]> {
  const settingsResponse = await dependencies.trainerSettingsApiService.getCurrent();
  const settings = settingsResponse.settings;
  const now = new Date();
  const nowParts = getMoscowDateParts(now);
  const todayStart = getMoscowStartOfDayFromParts(Number(nowParts.year), Number(nowParts.month), Number(nowParts.day));

  const dateKeys: string[] = [];
  for (let offset = 0; offset < settings.bookingHorizonDays; offset += 1) {
    const date = new Date(todayStart.getTime() + offset * 24 * 60 * 60 * 1000);
    dateKeys.push(getMoscowDateKey(date));
  }

  const horizonEnd = new Date(todayStart.getTime() + settings.bookingHorizonDays * 24 * 60 * 60 * 1000);
  const allSlots = await dependencies.slotsApiService.getTrainerSlots(
    dependencies.trainerTelegramId,
    todayStart.toISOString(),
    horizonEnd.toISOString(),
  );

  const slotsByDateKey = new Map<string, AvailableSlot[]>();
  for (const slot of allSlots) {
    const key = getMoscowDateKey(new Date(slot.startAt));
    const existing = slotsByDateKey.get(key);
    if (existing) existing.push(slot);
    else slotsByDateKey.set(key, [slot]);
  }

  return dateKeys.map((dateKey) => buildAdminDateSummary(dateKey, slotsByDateKey.get(dateKey) ?? []));
}

function buildAdminSlotsDayKeyboard(dateKey: string, slots: AvailableSlot[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const sorted = [...filterAdminVisibleSlots(slots)].sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
  );

  addGridButtons(
    keyboard,
    sorted.map((slot) => {
      const hour = getMoscowHour(new Date(slot.startAt));
      const hourLabel = `${String(hour).padStart(2, "0")}:00`;
      const marker = slot.status === "BOOKED" ? "🔒" : slot.status === "CLOSED" ? "🔴" : "🟢";
      return { label: `${marker} ${hourLabel}`, callbackData: `adm:slots:toggle:${dateKey}:${hour}` };
    }),
    2,
  );

  keyboard
    .text('Открыть рабочий день', `adm:slots:day:open:${dateKey}`)
    .row()
    .text('Закрыть рабочий день', `adm:slots:day:close:${dateKey}`)
    .row()
    .text('К выбору дат', 'screen:admin-slots')
    .row()
    .text('< В настройки', 'screen:admin-settings')
    .row()
    .text('В главное меню', 'screen:admin-main');

  return keyboard;
}

async function buildAdminSlotsDayView(
  dependencies: NavigationHandlerDependencies,
  dateKey: string,
): Promise<AdminSlotsView> {
  const dayRange = getMoscowDayRangeByKey(dateKey);
  if (!dayRange) {
    return {
      text: "Некорректная дата.",
      keyboard: new InlineKeyboard()
        .text("К выбору дат", "screen:admin-slots")
        .row()
        .text("< В настройки", "screen:admin-settings")
        .row()
        .text("В главное меню", "screen:admin-main"),
    };
  }

  const slots = await dependencies.slotsApiService.getTrainerSlots(
    dependencies.trainerTelegramId,
    dayRange.start.toISOString(),
    dayRange.end.toISOString(),
  );
  const visibleSlots = filterAdminVisibleSlots(slots);

  const openCount = visibleSlots.filter((slot) => slot.status === 'OPEN').length;
  const closedCount = visibleSlots.filter((slot) => slot.status === 'CLOSED').length;
  const bookedCount = visibleSlots.filter((slot) => slot.status === 'BOOKED').length;

  return {
    text: [
      'Панель админа > Даты и время.',
      '',
      `Дата: ${getMoscowDateLabel(dayRange.start)} (МСК).`,
      `Открыто: ${openCount}, закрыто: ${closedCount}, занято: ${bookedCount}.`,
      `Показаны часы: ${String(ADMIN_VISIBLE_HOUR_START).padStart(2, "0")}:00-${String(ADMIN_VISIBLE_HOUR_END).padStart(2, "0")}:00.`,
      '',
      'Нажмите на час, чтобы переключить статус.',
      'Метки: 🟢 открыто, 🔴 закрыто, 🔒 занято.',
    ].join('\n'),
    keyboard: buildAdminSlotsDayKeyboard(dateKey, slots),
  };
}
function buildAdminSettingsMainKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  return keyboard
    .text("Даты и время", "screen:admin-slots")
    .row()
    .text("Период для записи", "adm:settings:period")
    .row()
    .text("Запись заранее", "adm:settings:lead-time")
    .row()
    .text("Поиск клиента", "adm:settings:search")
    .row()
    .text("Черный список", "adm:settings:blacklist")
    .row()
    .text("В главное меню", "screen:admin-main");
}

function buildAdminSearchModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Завершить поиск", "adm:settings:search:stop")
    .row()
    .text("< В настройки", "screen:admin-settings")
    .row()
    .text("В главное меню", "screen:admin-main");
}

function buildAdminSearchResultKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Новый поиск", "adm:settings:search")
    .row()
    .text("< В настройки", "screen:admin-settings")
    .row()
    .text("В главное меню", "screen:admin-main");
}

function buildAdminClosePeriodActionKeyboard(closedPeriods: ClosedPeriodItem[]): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("Р—Р°РєСЂС‹С‚СЊ РЅРѕРІС‹Р№ РїРµСЂРёРѕРґ", "adm:closeperiod:new").row();

  for (const period of closedPeriods.slice(0, 12)) {
    const start = new Date(period.startAt);
    const endInclusive = new Date(new Date(period.endAt).getTime() - 1);
    const label = `РћС‚РјРµРЅРёС‚СЊ: ${slotDateFormatter.format(start)} вЂ” ${slotDateFormatter.format(endInclusive)}`;
    keyboard.text(label, `adm:closeperiod:reopenpick:${start.getTime()}:${new Date(period.endAt).getTime()}`).row();
  }

  keyboard.text("РћР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє", "adm:closeperiod:refresh").row().text("< Р’ РЅР°СЃС‚СЂРѕР№РєРё", "screen:admin-settings");
  return keyboard;
}

function buildAdminClosePeriodStepKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("РћС‚РјРµРЅР°", "adm:closeperiod:cancel")
    .row()
    .text("< Р’ РЅР°СЃС‚СЂРѕР№РєРё", "screen:admin-settings");
}

function buildAdminClosePeriodReasonKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("РћС‚РјРµРЅР°", "adm:closeperiod:cancel")
    .row()
    .text("< Р’ РЅР°СЃС‚СЂРѕР№РєРё", "screen:admin-settings");
}


function getMoscowStartOfDayFromParts(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
}

type MoscowDateParseResult =
  | { ok: true; date: Date }
  | { ok: false; reason: "format" | "invalid_date" };

function parseMoscowDateInput(value: string): MoscowDateParseResult {
  const raw = value.trim();
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/u);
  if (!match) {
    return { ok: false, reason: "format" };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearRaw = match[3];
  const year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return { ok: false, reason: "invalid_date" };
  }

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020 || year > 2100) {
    return { ok: false, reason: "invalid_date" };
  }

  const start = getMoscowStartOfDayFromParts(year, month, day);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(start);
  const normalizedDay = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  const normalizedMonth = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const normalizedYear = Number(parts.find((part) => part.type === "year")?.value ?? "0");

  if (normalizedDay !== day || normalizedMonth !== month || normalizedYear !== year) {
    return { ok: false, reason: "invalid_date" };
  }

  return { ok: true, date: start };
}

function buildClientCutoffHintText(cutoffHours: number): string | null {
  if (!Number.isInteger(cutoffHours) || cutoffHours <= 0) {
    return null;
  }

  return `Запись возможна минимум за ${cutoffHours} ч до начала тренировки.`;
}

function parseReopenPickCallback(data: string): { startAt: Date; endAt: Date } | null {
  const payload = data.replace("adm:closeperiod:reopenpick:", "").trim();
  const [startRaw, endRaw] = payload.split(":");
  if (!startRaw || !endRaw) {
    return null;
  }

  const startEpoch = Number(startRaw);
  const endEpoch = Number(endRaw);
  if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) {
    return null;
  }

  const startAt = new Date(startEpoch);
  const endAt = new Date(endEpoch);
  if (endAt.getTime() <= startAt.getTime()) {
    return null;
  }

  return { startAt, endAt };
}

function parseAdminSlotsToggleCallback(data: string): { dateKey: string; hour: number } | null {
  const payload = data.replace("adm:slots:toggle:", "").trim();
  const [dateKey, hourRaw] = payload.split(":");
  if (!dateKey || !hourRaw) {
    return null;
  }

  const hour = Number(hourRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  if (!parseAdminSlotsDateKey(dateKey)) {
    return null;
  }

  return { dateKey, hour };
}

function parseAdminSlotsDayActionCallback(data: string): { action: "open" | "close"; dateKey: string } | null {
  const payload = data.replace("adm:slots:day:", "").trim();
  const [actionRaw, dateKey] = payload.split(":");
  if (!actionRaw || !dateKey) {
    return null;
  }

  const action = actionRaw === "open" || actionRaw === "close" ? actionRaw : null;
  if (!action || !parseAdminSlotsDateKey(dateKey)) {
    return null;
  }

  return {
    action,
    dateKey,
  };
}

function parseAdminSlotsRangeApplyCallback(
  data: string,
): { action: "open" | "close"; startDateKey: string; endDateKey: string } | null {
  const payload = data.replace("adm:slots:range:apply:", "").trim();
  const [actionRaw, startDateKey, endDateKey] = payload.split(":");
  if (!actionRaw || !startDateKey || !endDateKey) {
    return null;
  }

  if ((actionRaw !== "open" && actionRaw !== "close") || !parseAdminSlotsDateKey(startDateKey) || !parseAdminSlotsDateKey(endDateKey)) {
    return null;
  }

  const sorted = sortRangeKeys(startDateKey, endDateKey);
  return {
    action: actionRaw,
    startDateKey: sorted.startDateKey,
    endDateKey: sorted.endDateKey,
  };
}

function parseTemplateWeekdayCallback(data: string): number | "all" | "none" | null {
  const payload = data.replace("adm:slots:tpl:wd:", "").trim();
  if (payload === "all" || payload === "none") {
    return payload;
  }

  const weekday = Number(payload);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return null;
  }

  return weekday;
}

function parseTemplateHourCallback(data: string): number | "all" | "none" | null {
  const payload = data.replace("adm:slots:tpl:hr:", "").trim();
  if (payload === "all" || payload === "none") {
    return payload;
  }

  const hour = Number(payload);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }

  return hour;
}

function toggleNumberInArray(items: number[], value: number): number[] {
  const set = new Set(items);
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }

  return Array.from(set.values()).sort((left, right) => left - right);
}

function buildHourRanges(startTimes: Date[]): Array<{ startAt: Date; endAt: Date }> {
  if (startTimes.length === 0) {
    return [];
  }

  const sorted = [...startTimes].sort((left, right) => left.getTime() - right.getTime());
  const ranges: Array<{ startAt: Date; endAt: Date }> = [];
  let currentStart = sorted[0];
  let currentEnd = new Date(currentStart.getTime() + 60 * 60 * 1000);

  for (let index = 1; index < sorted.length; index += 1) {
    const start = sorted[index];
    if (start.getTime() === currentEnd.getTime()) {
      currentEnd = new Date(currentEnd.getTime() + 60 * 60 * 1000);
      continue;
    }

    ranges.push({ startAt: currentStart, endAt: currentEnd });
    currentStart = start;
    currentEnd = new Date(start.getTime() + 60 * 60 * 1000);
  }

  ranges.push({ startAt: currentStart, endAt: currentEnd });
  return ranges;
}

async function buildAdminClosePeriodsHubView(
  dependencies: NavigationHandlerDependencies,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const response = await dependencies.slotsApiService.getClosedPeriods(dependencies.trainerTelegramId);
  const items = response.items;

  if (items.length === 0) {
    return {
      text: [
        "РџР°РЅРµР»СЊ Р°РґРјРёРЅР° > Р—Р°РєСЂС‹С‚РёРµ РїРµСЂРёРѕРґРѕРІ.",
        "",
        "Р—Р°РєСЂС‹С‚С‹С… РїРµСЂРёРѕРґРѕРІ РїРѕРєР° РЅРµС‚.",
        "РќР°Р¶РјРёС‚Рµ В«Р—Р°РєСЂС‹С‚СЊ РЅРѕРІС‹Р№ РїРµСЂРёРѕРґВ», С‡С‚РѕР±С‹ РґРѕР±Р°РІРёС‚СЊ РїРµСЂРёРѕРґ СЃ РїСЂРёС‡РёРЅРѕР№.",
      ].join("\n"),
      keyboard: buildAdminClosePeriodActionKeyboard(items),
    };
  }

  const lines = items.slice(0, 12).map((period, index) => {
    const start = new Date(period.startAt);
    const endInclusive = new Date(new Date(period.endAt).getTime() - 1);
    return `${index + 1}. ${adminDateTimeFormatter.format(start)} вЂ” ${adminDateTimeFormatter.format(endInclusive)} | РїСЂРёС‡РёРЅР°: ${period.reason}`;
  });

  const hiddenCount = items.length > 12 ? items.length - 12 : 0;

  return {
    text: [
      "РџР°РЅРµР»СЊ Р°РґРјРёРЅР° > Р—Р°РєСЂС‹С‚РёРµ РїРµСЂРёРѕРґРѕРІ.",
      "",
      "РўРµРєСѓС‰РёРµ Р·Р°РєСЂС‹С‚С‹Рµ РїРµСЂРёРѕРґС‹:",
      ...lines,
      hiddenCount > 0 ? `... Рё РµС‰Рµ ${hiddenCount}` : "",
      "",
      "РќРёР¶Рµ РјРѕР¶РЅРѕ РѕС‚РєСЂС‹С‚СЊ РїРµСЂРёРѕРґ РѕР±СЂР°С‚РЅРѕ РєРЅРѕРїРєРѕР№ В«РћС‚РјРµРЅРёС‚СЊ: ...В».",
    ]
      .filter(Boolean)
      .join("\n"),
    keyboard: buildAdminClosePeriodActionKeyboard(items),
  };
}

function formatClientShortName(client: ClientProfile): string {
  if (client.username?.trim()) {
    return `@${client.username.trim().replace(/^@/u, "")}`;
  }

  return client.fullName;
}

function buildAdminBlacklistKeyboard(items: ClientProfile[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const client of items.slice(0, 20)) {
    const label = `Убрать: ${formatClientShortName(client)}`;
    keyboard.text(label, `adm:blacklist:rm:${client.id}`).row();
  }

  keyboard
    .text("Обновить список", "adm:blacklist:refresh")
    .row()
    .text("< В настройки", "screen:admin-settings")
    .row()
    .text("В главное меню", "screen:admin-main");

  return keyboard;
}

async function buildAdminBlacklistView(
  dependencies: NavigationHandlerDependencies,
): Promise<AdminBlacklistView> {
  const response = await dependencies.clientsApiService.getBlacklist();
  const items = response.items;

  if (items.length === 0) {
    return {
      text: [
        "Панель админа > Черный список.",
        "",
        "Черный список пуст.",
        "Пока нет клиентов в ЧС, поэтому кнопок удаления не будет.",
      ].join("\n"),
      keyboard: new InlineKeyboard()
        .text("Обновить список", "adm:blacklist:refresh")
        .row()
        .text("< В настройки", "screen:admin-settings")
        .row()
        .text("В главное меню", "screen:admin-main"),
    };
  }

  const lines = items.slice(0, 20).map((client, index) => {
    const reason = client.blacklistReason?.trim() ? client.blacklistReason : "без причины";
    return `${index + 1}. ${client.fullName} (${formatClientShortName(client)}), причина: ${reason}`;
  });

  const hiddenCount = items.length > 20 ? items.length - 20 : 0;

  return {
    text: [
      "Панель админа > Черный список.",
      "",
      "Клиенты в ЧС:",
      ...lines,
      hiddenCount > 0 ? `... и еще ${hiddenCount}` : "",
      "",
      "Нажмите кнопку клиента, чтобы удалить его из черного списка.",
    ]
      .filter(Boolean)
      .join("\n"),
    keyboard: buildAdminBlacklistKeyboard(items),
  };
}

function buildAdminSettingsPeriodKeyboard(settings: TrainerSettingsDto): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  return keyboard
    .text(settings.bookingHorizonDays === 7 ? "• 1 неделя" : "1 неделя", "adm:settings:set:horizon:7")
    .text(settings.bookingHorizonDays === 14 ? "• 2 недели" : "2 недели", "adm:settings:set:horizon:14")
    .row()
    .text(settings.bookingHorizonDays === 21 ? "• 3 недели" : "3 недели", "adm:settings:set:horizon:21")
    .text(settings.bookingHorizonDays === 28 ? "• 4 недели" : "4 недели", "adm:settings:set:horizon:28")
    .row()
    .text("< В настройки", "screen:admin-settings")
    .row()
    .text("В главное меню", "screen:admin-main");
}

function buildAdminSettingsLeadTimeKeyboard(settings: TrainerSettingsDto): InlineKeyboard {
  const values = [0, 1, 2, 3, 6, 12];
  const keyboard = new InlineKeyboard();

  for (let index = 0; index < values.length; index += 2) {
    const left = values[index];
    const right = values[index + 1];
      keyboard.text(
      settings.sameDayBookingCutoff === left ? `• ${left} ч` : `${left} ч`,
      `adm:settings:set:cutoff:${left}`,
    );
    if (typeof right === "number") {
      keyboard.text(
        settings.sameDayBookingCutoff === right ? `• ${right} ч` : `${right} ч`,
        `adm:settings:set:cutoff:${right}`,
      );
    }
    keyboard.row();
  }

  keyboard
    .text("< В настройки", "screen:admin-settings")
    .row()
    .text("В главное меню", "screen:admin-main");
  return keyboard;
}

function buildAdminClientSearchResultsText(query: string, items: ClientProfile[]): string {
  if (items.length === 0) {
    return [
      "Панель админа > Поиск клиента.",
      "",
      `Запрос: ${query}`,
      "Совпадений не найдено.",
    ].join("\n");
  }

  const lines = items.map((client, index) => {
    const phone = client.phone?.trim() ? client.phone : "не указан";
    const username = client.username?.trim() ? `@${client.username.trim().replace(/^@/u, "")}` : "не указан";
    const status = client.isBlacklisted ? "в ЧС" : "активен";

    return `${index + 1}. ${client.fullName} | Телефон: ${phone} | Username: ${username} | Статус: ${status}`;
  });

  return [
    "Панель админа > Поиск клиента.",
    "",
    `Запрос: ${query}`,
    `Найдено: ${items.length}`,
    "",
    ...lines,
  ].join("\n");
}

function getAdminClientSearchErrorMessage(error: Error): string {
  if (error.message.includes("Search query must contain at least 2 characters")) {
    return "Введите минимум 2 символа для поиска";
  }

  if (error.message.includes("Only trainer can manage blacklist")) {
    return "Поиск доступен только тренеру";
  }

  return "Не удалось выполнить поиск";
}

async function buildAdminSettingsView(
  dependencies: NavigationHandlerDependencies,
): Promise<AdminSettingsView> {
  const response = await dependencies.trainerSettingsApiService.getCurrent();
  const settings = response.settings;
  const updatedAt = adminDateTimeFormatter.format(new Date(settings.updatedAt));

  return {
    text: [
      "Панель админа.",
      "",
      "Что здесь можно настроить:",
      "- даты и время слотов;",
      "- период для записи;",
      "- за сколько времени можно записаться;",
      "- поиск клиента;",
      "- черный список.",
      "",
      `Текущий период записи: ${settings.bookingHorizonDays} дн.`,
      `Текущая запись заранее: ${settings.sameDayBookingCutoff} ч.`,
      "",
      `Обновлено: ${updatedAt} (МСК).`,
    ].join("\n"),
    keyboard: buildAdminSettingsMainKeyboard(),
  };
}

function buildAdminMainView(): AdminMainView {
  const keyboard = new InlineKeyboard()
    .text("Заявки", "screen:admin-requests")
    .row()
    .text("Панель админа", "screen:admin-settings");

  return {
    text: "Выберите раздел ↓",
    keyboard,
  };
}

export function registerNavigationHandler(
  bot: Bot<Context>,
  dependencies: NavigationHandlerDependencies,
) {
  bot.on("message:text", async (context, next) => {
    const userId = context.from?.id;
    if (!userId) {
      await next();
      return;
    }

    const role = dependencies.resolveRole(userId);
    const rawText = context.message.text ?? "";
    const normalizedText = rawText.trim().toLowerCase();

    if (normalizedText === "/start" || normalizedText === "start") {
      adminClosePeriodDraftByUser.delete(userId);
      adminClientSearchModeUsers.delete(userId);
      adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);

      if (normalizedText === "start" && role === "admin") {
        const adminMainView = buildAdminMainView();
        await context.reply(adminMainView.text, {
          reply_markup: adminMainView.keyboard,
        });
        return;
      }

      await next();
      return;
    }

    const closePeriodDraft = adminClosePeriodDraftByUser.get(userId);
    if (closePeriodDraft) {
      if (role !== "admin") {
        adminClosePeriodDraftByUser.delete(userId);
        adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
        await next();
        return;
      }

      if (rawText.startsWith("/")) {
        adminClosePeriodDraftByUser.delete(userId);
        adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
        await next();
        return;
      }

      if (closePeriodDraft.step === "await_start_date") {
        const startAtParsed = parseMoscowDateInput(rawText);
        if (!startAtParsed.ok) {
          const message = startAtParsed.reason === "format"
            ? "Шаг 1 из 3: введите дату начала в формате ДД.ММ.ГГГГ или ДД.ММ.ГГ, например 25.05.2026."
            : "Шаг 1 из 3: такой даты не существует. Введите реальную дату, например 25.05.2026.";
          await context.reply(message, {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          });
          return;
        }
        const startAt = startAtParsed.date;

        const todayStart = getMoscowStartOfDayFromParts(
          Number(
            new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", year: "numeric" })
              .format(new Date()),
          ),
          Number(
            new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", month: "2-digit" })
              .format(new Date()),
          ),
          Number(
            new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", day: "2-digit" })
              .format(new Date()),
          ),
        );
        if (startAt.getTime() < todayStart.getTime()) {
          await context.reply("РЁР°Рі 1 РёР· 3: РЅРµР»СЊР·СЏ РІС‹Р±СЂР°С‚СЊ РїСЂРѕС€РµРґС€СѓСЋ РґР°С‚Сѓ. РЈРєР°Р¶РёС‚Рµ СЃРµРіРѕРґРЅСЏС€РЅСЋСЋ РёР»Рё Р±СѓРґСѓС‰СѓСЋ.", {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          });
          return;
        }

        adminClosePeriodDraftByUser.set(userId, {
          step: "await_end_date",
          startAtIso: startAt.toISOString(),
        });

        await context.reply(
          [
            "РЁР°Рі 1 РІС‹РїРѕР»РЅРµРЅ: РґР°С‚Р° РЅР°С‡Р°Р»Р° РїСЂРёРЅСЏС‚Р°.",
            `Р”Р°С‚Р° РЅР°С‡Р°Р»Р°: ${adminDateTimeFormatter.format(startAt)} (РњРЎРљ).`,
            "",
            "РЁР°Рі 2 РёР· 3: РІРІРµРґРёС‚Рµ РґР°С‚Сѓ РѕРєРѕРЅС‡Р°РЅРёСЏ РІ С„РѕСЂРјР°С‚Рµ Р”Р”.РњРњ.Р“Р“Р“Р“ (РёР»Рё Р”Р”.РњРњ.Р“Р“).",
            "Р”Р°С‚Р° РѕРєРѕРЅС‡Р°РЅРёСЏ РІРєР»СЋС‡Р°РµС‚СЃСЏ РІ Р·Р°РєСЂС‹С‚С‹Р№ РїРµСЂРёРѕРґ.",
          ].join("\n"),
          {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          },
        );
        return;
      }

      if (closePeriodDraft.step === "await_end_date") {
        const endDateParsed = parseMoscowDateInput(rawText);
        if (!endDateParsed.ok) {
          const message = endDateParsed.reason === "format"
            ? "РЁР°Рі 2 РёР· 3: РІРІРµРґРёС‚Рµ РґР°С‚Сѓ РѕРєРѕРЅС‡Р°РЅРёСЏ РІ С„РѕСЂРјР°С‚Рµ Р”Р”.РњРњ.Р“Р“Р“Р“ (РёР»Рё Р”Р”.РњРњ.Р“Р“), РЅР°РїСЂРёРјРµСЂ 27.05.2026."
            : "РЁР°Рі 2 РёР· 3: С‚Р°РєРѕР№ РґР°С‚С‹ РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚. Р’РІРµРґРёС‚Рµ СЂРµР°Р»СЊРЅСѓСЋ РґР°С‚Сѓ РѕРєРѕРЅС‡Р°РЅРёСЏ, РЅР°РїСЂРёРјРµСЂ 27.05.2026.";
          await context.reply(message, {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          });
          return;
        }
        const endDate = endDateParsed.date;

        if (!closePeriodDraft.startAtIso) {
          await context.reply("РЎРЅР°С‡Р°Р»Р° СѓРєР°Р¶РёС‚Рµ РґР°С‚Сѓ РЅР°С‡Р°Р»Р° РїРµСЂРёРѕРґР°.", {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          });
          return;
        }

        const startAt = new Date(closePeriodDraft.startAtIso);
        if (endDate.getTime() < startAt.getTime()) {
          await context.reply("РЁР°Рі 2 РёР· 3: РґР°С‚Р° РѕРєРѕРЅС‡Р°РЅРёСЏ РЅРµ РјРѕР¶РµС‚ Р±С‹С‚СЊ СЂР°РЅСЊС€Рµ РґР°С‚С‹ РЅР°С‡Р°Р»Р°.", {
            reply_markup: buildAdminClosePeriodStepKeyboard(),
          });
          return;
        }

        const endAtExclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
        adminClosePeriodDraftByUser.set(userId, {
          step: "await_reason",
          startAtIso: closePeriodDraft.startAtIso,
          endAtIso: endAtExclusive.toISOString(),
        });

        await context.reply(
          [
            "РЁР°Рі 2 РІС‹РїРѕР»РЅРµРЅ: РґРёР°РїР°Р·РѕРЅ РїСЂРёРЅСЏС‚.",
            `РџРµСЂРёРѕРґ: ${adminDateTimeFormatter.format(startAt)} вЂ” ${adminDateTimeFormatter.format(endDate)} (РњРЎРљ).`,
            "",
            "РЁР°Рі 3 РёР· 3: РѕС‚РїСЂР°РІСЊС‚Рµ РїСЂРёС‡РёРЅСѓ РѕРґРЅРёРј СЃРѕРѕР±С‰РµРЅРёРµРј РІ С‡Р°С‚.",
          ].join("\n"),
          {
            reply_markup: buildAdminClosePeriodReasonKeyboard(),
          },
        );
        return;
      }

      const reason = rawText.trim();
      if (reason.length < 3) {
        await context.reply("РџСЂРёС‡РёРЅР° СЃР»РёС€РєРѕРј РєРѕСЂРѕС‚РєР°СЏ. РќР°РїРёС€РёС‚Рµ РјРёРЅРёРјСѓРј 3 СЃРёРјРІРѕР»Р°.", {
          reply_markup: buildAdminClosePeriodReasonKeyboard(),
        });
        return;
      }

      if (!closePeriodDraft.startAtIso) {
        await context.reply("РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РґР°С‚Сѓ РЅР°С‡Р°Р»Р° РїРµСЂРёРѕРґР°.", {
          reply_markup: buildAdminClosePeriodStepKeyboard(),
        });
        return;
      }

      if (!closePeriodDraft.endAtIso) {
        await context.reply("РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РґР°С‚Сѓ РѕРєРѕРЅС‡Р°РЅРёСЏ РїРµСЂРёРѕРґР°.", {
          reply_markup: buildAdminClosePeriodStepKeyboard(),
        });
        return;
      }

      const startAt = new Date(closePeriodDraft.startAtIso);
      const endAt = new Date(closePeriodDraft.endAtIso);
      const endDateInclusive = new Date(endAt.getTime() - 24 * 60 * 60 * 1000);

      try {
        const closeResult = await dependencies.slotsApiService.closeSlots({
          trainerTelegramId: dependencies.trainerTelegramId,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          reason,
        });

        adminClosePeriodDraftByUser.delete(userId);

        await context.reply(
          [
            "РџРµСЂРёРѕРґ Р·Р°РєСЂС‹С‚.",
            `Р”РёР°РїР°Р·РѕРЅ: ${adminDateTimeFormatter.format(startAt)} вЂ” ${adminDateTimeFormatter.format(endDateInclusive)} (РњРЎРљ).`,
            `РџСЂРёС‡РёРЅР° РґР»СЏ РєР»РёРµРЅС‚Р°: ${reason}`,
            `Р—Р°РєСЂС‹С‚Рѕ СЃР»РѕС‚РѕРІ: ${closeResult.closed}.`,
            closeResult.skippedBooked > 0 ? `РџСЂРѕРїСѓС‰РµРЅРѕ Р·Р°РЅСЏС‚С‹С… СЃР»РѕС‚РѕРІ: ${closeResult.skippedBooked}.` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          {
            reply_markup: new InlineKeyboard()
              .text("Р—Р°РєСЂС‹С‚СЊ РµС‰Рµ РїРµСЂРёРѕРґ", "adm:settings:close-period")
              .row()
              .text("< Р’ РЅР°СЃС‚СЂРѕР№РєРё", "screen:admin-settings"),
          },
        );
      } catch (error) {
        const normalizedError = error as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ РїРµСЂРёРѕРґ СЃР»РѕС‚РѕРІ", {
          userId,
          startAt: closePeriodDraft.startAtIso,
          endAt: closePeriodDraft.endAtIso,
          reason,
          message: normalizedError.message,
        });
        await context.reply("РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РєСЂС‹С‚СЊ РїРµСЂРёРѕРґ. РџСЂРѕРІРµСЂСЊС‚Рµ API Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°.", {
          reply_markup: buildAdminClosePeriodReasonKeyboard(),
        });
      }
      return;
    }

    if (!adminClientSearchModeUsers.has(userId)) {
      await next();
      return;
    }

    if (role !== "admin") {
      adminClientSearchModeUsers.delete(userId);
      await next();
      return;
    }

    if (rawText.startsWith("/")) {
      adminClientSearchModeUsers.delete(userId);
      await next();
      return;
    }

    const query = rawText.trim();
    if (query.length < 2) {
      await context.reply(
        "Р”Р»СЏ РїРѕРёСЃРєР° РЅСѓР¶РЅРѕ РјРёРЅРёРјСѓРј 2 СЃРёРјРІРѕР»Р°. Р’РІРµРґРёС‚Рµ РёРјСЏ РёР»Рё С‚РµР»РµС„РѕРЅ РєР»РёРµРЅС‚Р°.",
        {
          reply_markup: buildAdminSearchModeKeyboard(),
        },
      );
      return;
    }

    try {
      const response = await dependencies.clientsApiService.searchClients(query, 10);
      await context.reply(buildAdminClientSearchResultsText(query, response.items), {
        reply_markup: buildAdminSearchResultKeyboard(),
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ РїРѕРёСЃРє РєР»РёРµРЅС‚Р°", {
        userId,
        query,
        message: normalizedError.message,
      });

      await context.reply(getAdminClientSearchErrorMessage(normalizedError), {
        reply_markup: buildAdminSearchModeKeyboard(),
      });
    }
  });

  bot.callbackQuery(/^screen:/, async (context) => {
    const userId = context.from?.id;
    const callbackData = context.callbackQuery.data;

    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    const targetScreen = getScreenIdFromCallback(callbackData);
    const requestedAdminScreen = targetScreen.startsWith("admin-");

    // Any screen navigation cancels temporary text-input modes.
    adminClosePeriodDraftByUser.delete(userId);
    adminClientSearchModeUsers.delete(userId);
    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);

    if (requestedAdminScreen) {
      dependencies.logger.info("РџРѕРїС‹С‚РєР° РІС…РѕРґР° РІ Р°РґРјРёРЅСЃРєРёР№ СЂРµР¶РёРј", {
        userId,
        username: context.from?.username ?? null,
        role,
        targetScreen,
      });
    }

    if (!canAccessScreen(role, targetScreen)) {
      dependencies.logger.warn("РћС€РёР±РєР° РїРµСЂРµС…РѕРґР° РїРѕ РєРЅРѕРїРєРµ", {
        userId,
        role,
        targetScreen,
        reason: "forbidden_screen_for_role",
      });

      await context.answerCallbackQuery({
        text: role === "admin" ? "Клиентское меню для тренера отключено." : "Этот раздел недоступен.",
        show_alert: true,
      });

      return;
    }

    const openedClientScreen = targetScreen.startsWith("client-");
    if (openedClientScreen) {
      try {
        const profile = await dependencies.registrationService.getRegisteredClient(userId);
        const inProgress = dependencies.registrationService.isRegistrationInProgress(userId);

        if (!profile && inProgress) {
          await context.answerCallbackQuery({
            text: "Продолжи регистрацию в чате",
          });
          await context.reply("Регистрация уже начата. Продолжай шаги в чате.");
          return;
        }

        if (!profile) {
          await context.answerCallbackQuery({
            text: "Сначала завершите регистрацию",
          });
          await dependencies.registrationService.start(context);
          return;
        }

        if (inProgress) {
          dependencies.registrationService.clearRegistrationState(userId);
        }
      } catch (error) {
        const normalizedError = error as Error;

        dependencies.logger.error("РћС€РёР±РєР° РїСЂРѕРІРµСЂРєРё СЂРµРіРёСЃС‚СЂР°С†РёРё РїСЂРё РІС…РѕРґРµ РІ РєР»РёРµРЅС‚СЃРєРёР№ СЌРєСЂР°РЅ", {
          userId,
          role,
          targetScreen,
          message: normalizedError.message,
        });

        await context.answerCallbackQuery({
          text: "Не удалось проверить регистрацию",
          show_alert: true,
        });
        await context.reply("Не удалось проверить регистрацию. Проверь, что API и база запущены.");
        return;
      }
    }

    try {
      const openedScreen = dependencies.navigationService.moveTo(userId, role, targetScreen);
      const staticView = buildScreenView(openedScreen, role);

      let text = staticView.text;
      let keyboard = staticView.keyboard;

      if (openedScreen === "admin-main" && role === "admin") {
        const adminMainView = buildAdminMainView();
        text = adminMainView.text;
        keyboard = adminMainView.keyboard;
      }

      if (openedScreen === "client-booking") {
        const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies);
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (openedScreen === "client-trainings") {
        const dynamicView = await buildClientTrainingsView(userId, staticView.text, dependencies);
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (openedScreen === "client-no-slot") {
        const dynamicView = buildClientNoSlotView();
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (openedScreen === "admin-requests") {
        const adminView = await buildAdminRequestsView(dependencies);
        text = adminView.text;
        keyboard = adminView.keyboard;
      }

      if (openedScreen === "admin-slots") {
        const adminSlotsView = await buildAdminSlotsView(dependencies);
        text = adminSlotsView.text;
        keyboard = adminSlotsView.keyboard;
      }

      if (openedScreen === "admin-settings") {
        const adminSettingsView = await buildAdminSettingsView(dependencies);
        text = adminSettingsView.text;
        keyboard = adminSettingsView.keyboard;
      }

      dependencies.logger.info("РћС‚РєСЂС‹С‚ СЌРєСЂР°РЅ", {
        userId,
        role,
        screenId: openedScreen,
        source: "callback",
      });

      await context.editMessageText(text, {
        reply_markup: keyboard,
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      const errorMessage = normalizedError.message;

      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({
          text: "Экран уже открыт",
        });
        return;
      }

      dependencies.logger.error("РћС€РёР±РєР° РїРµСЂРµС…РѕРґР° РїРѕ РєРЅРѕРїРєРµ", {
        userId,
        role,
        targetScreen,
        message: errorMessage,
      });

      await context.answerCallbackQuery({
        text: "Не удалось открыть раздел. Попробуйте снова.",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^slot:(book|time):/, async (context) => {
    const userId = context.from?.id;

    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const slotId = context.callbackQuery.data.replace(/^slot:(book|time):/u, "").trim();
    if (!slotId) {
      await context.answerCallbackQuery({
        text: "Некорректный слот",
        show_alert: true,
      });
      return;
    }

    try {
      const inProgress = dependencies.registrationService.isRegistrationInProgress(userId);
      if (inProgress) {
        await context.answerCallbackQuery({
          text: "Сначала завершите регистрацию",
          show_alert: true,
        });
        return;
      }

      const profile = await dependencies.registrationService.getRegisteredClient(userId);
      if (!profile) {
        await context.answerCallbackQuery({ text: "Нужна регистрация" });
        await dependencies.registrationService.start(context);
        return;
      }

      const result = await dependencies.bookingsApiService.requestBooking({
        telegramId: String(userId),
        slotId,
      });

      const startAt = new Date(result.booking.startAt);

      await context.answerCallbackQuery({
        text: "Заявка отправлена",
      });
      await sendOrReplaceClientNotice(
        context.api,
        String(userId),
        `Заявка отправлена тренеру: ${slotTimeFormatter.format(startAt)} (МСК). Ожидайте подтверждение.`,
        buildClientQuickActionsKeyboard(),
      );

      const requesterUsername = context.from?.username?.trim().replace(/^@/u, "") ?? "";
      const notifyText = [
        "Новая заявка на тренировку.",
        `Клиент: ${context.from?.first_name ?? "клиент"} (${userId})`,
        requesterUsername ? `Username: @${requesterUsername}` : null,
        `Время: ${adminDateTimeFormatter.format(startAt)} (МСК)`,
        "Откройте раздел «Заявки», чтобы принять решение.",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
      const notifyKeyboard = new InlineKeyboard()
        .text("Открыть заявки", "screen:admin-requests")
        .row()
        .text("В главное меню", "screen:admin-main");

      for (const chatId of getAdminNotificationRecipients(dependencies)) {
        try {
          await sendOrReplaceAdminNotice(context.api, chatId, notifyText, notifyKeyboard);
        } catch (notifyError) {
          const normalizedNotifyError = notifyError as Error;
          dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёРµ С‚СЂРµРЅРµСЂСѓ Рѕ РЅРѕРІРѕР№ Р·Р°СЏРІРєРµ", {
            chatId,
            userId,
            message: normalizedNotifyError.message,
          });
        }
      }

      const currentRole = dependencies.resolveRole(userId);
      const openedScreen = dependencies.navigationService.moveTo(userId, currentRole, "client-booking");
      const staticView = buildScreenView(openedScreen, currentRole);
      const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies);

      await context.editMessageText(dynamicView.text, {
        reply_markup: dynamicView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;

      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ Р·Р°СЏРІРєСѓ РЅР° СЃР»РѕС‚", {
        userId,
        slotId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getBookingErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^slot:date:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const selectedDateKey = parseDateKeyFromCallback(context.callbackQuery.data);
    if (!selectedDateKey) {
      await context.answerCallbackQuery({
        text: "Не удалось открыть дату",
        show_alert: true,
      });
      return;
    }

    try {
      const role = dependencies.resolveRole(userId);
      const currentScreen = dependencies.navigationService.getCurrent(userId, role);
      if (currentScreen !== "client-booking") {
        await context.answerCallbackQuery({
          text: "Откройте раздел записи",
        });
        return;
      }

      const staticView = buildScreenView("client-booking", role);
      const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies, {
        selectedDateKey,
      });
      await context.editMessageText(dynamicView.text, {
        reply_markup: dynamicView.keyboard,
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РґР°С‚Сѓ СЃР»РѕС‚РѕРІ", {
        userId,
        selectedDateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть время на эту дату",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^slot:page:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    const staticView = buildScreenView("client-booking", role);
    const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies);
    await context.editMessageText(dynamicView.text, {
      reply_markup: dynamicView.keyboard,
    });
    await context.answerCallbackQuery({
      text: "Сначала выберите дату",
    });
  });

  bot.callbackQuery("noop", async (context) => {
    await context.answerCallbackQuery({
      text: "Дальше листать нельзя",
    });
  });

  bot.callbackQuery(/^slot:datepage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const requestedPage = parseDatePageFromCallback(context.callbackQuery.data);
    if (requestedPage === null) {
      await context.answerCallbackQuery({
        text: "Некорректная страница дат",
        show_alert: true,
      });
      return;
    }

    try {
      const role = dependencies.resolveRole(userId);
      const currentScreen = dependencies.navigationService.getCurrent(userId, role);
      if (currentScreen !== "client-booking") {
        await context.answerCallbackQuery({
          text: "Откройте раздел записи",
        });
        return;
      }

      const staticView = buildScreenView("client-booking", role);
      const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies, {
        datePage: requestedPage,
      });
      await context.editMessageText(dynamicView.text, {
        reply_markup: dynamicView.keyboard,
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЃС‚СЂР°РЅРёС†Сѓ РґР°С‚", {
        userId,
        requestedPage,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть следующую страницу дат",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^slot:timepage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseTimePageFromCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректная страница времени",
        show_alert: true,
      });
      return;
    }

    try {
      const role = dependencies.resolveRole(userId);
      const currentScreen = dependencies.navigationService.getCurrent(userId, role);
      if (currentScreen !== "client-booking") {
        await context.answerCallbackQuery({
          text: "Откройте раздел записи",
        });
        return;
      }

      const staticView = buildScreenView("client-booking", role);
      const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies, {
        selectedDateKey: parsed.dateKey,
        timePage: parsed.page,
      });
      await context.editMessageText(dynamicView.text, {
        reply_markup: dynamicView.keyboard,
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЃС‚СЂР°РЅРёС†Сѓ РІСЂРµРјРµРЅРё", {
        userId,
        dateKey: parsed.dateKey,
        requestedPage: parsed.page,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть следующую страницу времени",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:period", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const settings = (await dependencies.trainerSettingsApiService.getCurrent()).settings;
      await context.editMessageText(
        [
          "Панель админа > Период для записи.",
          "",
          "Выберите, на сколько недель открыта запись.",
          "",
          `Сейчас: ${settings.bookingHorizonDays} дней.`,
        ].join("\n"),
        {
        reply_markup: buildAdminSettingsPeriodKeyboard(settings),
        },
      );
      await context.answerCallbackQuery({
        text: "Период для записи",
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РЅР°СЃС‚СЂРѕР№РєРё РїРµСЂРёРѕРґР° Р·Р°РїРёСЃРё", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть период записи",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:lead-time", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const settings = (await dependencies.trainerSettingsApiService.getCurrent()).settings;
      await context.editMessageText(
        [
          "Панель админа > Запись заранее.",
          "",
          "Выберите, за сколько часов до тренировки клиент еще может записаться.",
          "",
          `Сейчас: ${settings.sameDayBookingCutoff} часов.`,
        ].join("\n"),
        {
        reply_markup: buildAdminSettingsLeadTimeKeyboard(settings),
        },
      );
      await context.answerCallbackQuery({
        text: "Запись заранее",
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РЅР°СЃС‚СЂРѕР№РєСѓ Р·Р°РїРёСЃРё Р·Р°СЂР°РЅРµРµ", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть настройку",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:settings:set:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseTrainerSettingsPresetCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректный параметр",
        show_alert: true,
      });
      return;
    }

    try {
      if (parsed.field === "horizon") {
        await dependencies.trainerSettingsApiService.update({ bookingHorizonDays: parsed.value });
        const settings = (await dependencies.trainerSettingsApiService.getCurrent()).settings;
        await context.editMessageText(
          [
            "Панель админа > Период для записи.",
            "",
            "Выберите, на сколько недель открыта запись.",
            "",
            `Сейчас: ${settings.bookingHorizonDays} дней.`,
          ].join("\n"),
          {
            reply_markup: buildAdminSettingsPeriodKeyboard(settings),
          },
        );
      } else {
        await dependencies.trainerSettingsApiService.update({ sameDayBookingCutoff: parsed.value });
        const settings = (await dependencies.trainerSettingsApiService.getCurrent()).settings;
        await context.editMessageText(
          [
            "Панель админа > Запись заранее.",
            "",
            "Выберите, за сколько часов до тренировки клиент еще может записаться.",
            "",
            `Сейчас: ${settings.sameDayBookingCutoff} часов.`,
          ].join("\n"),
          {
            reply_markup: buildAdminSettingsLeadTimeKeyboard(settings),
          },
        );
      }

      await context.answerCallbackQuery({
        text: "Сохранено",
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РїСЂРµСЃРµС‚ РЅР°СЃС‚СЂРѕР№РєРё", {
        userId,
        field: parsed.field,
        value: parsed.value,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось сохранить",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:blacklist", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const view = await buildAdminBlacklistView(dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Черный список" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ С‡РµСЂРЅС‹Р№ СЃРїРёСЃРѕРє", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ С‡РµСЂРЅС‹Р№ СЃРїРёСЃРѕРє",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:close-period", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    adminClosePeriodDraftByUser.delete(userId);
    adminClientSearchModeUsers.delete(userId);
    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);

    try {
      const hubView = await buildAdminClosePeriodsHubView(dependencies);
      await context.editMessageText(hubView.text, {
        reply_markup: hubView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Открыт список периодов" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЂР°Р·РґРµР» Р·Р°РєСЂС‹С‚С‹С… РїРµСЂРёРѕРґРѕРІ", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть список периодов",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:closeperiod:refresh", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const hubView = await buildAdminClosePeriodsHubView(dependencies);
      await context.editMessageText(hubView.text, {
        reply_markup: hubView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Список обновлен" });
    } catch (error) {
      const normalizedError = error as Error;

      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }

      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє Р·Р°РєСЂС‹С‚С‹С… РїРµСЂРёРѕРґРѕРІ", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось обновить список",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:closeperiod:new", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    adminClosePeriodDraftByUser.set(userId, {
      step: "await_start_date",
    });

    await context.editMessageText(
      [
        "РџР°РЅРµР»СЊ Р°РґРјРёРЅР° > Р—Р°РєСЂС‹С‚РёРµ РїРµСЂРёРѕРґРѕРІ.",
        "",
        "Р РµР¶РёРј: Р·Р°РєСЂС‹С‚СЊ РїРµСЂРёРѕРґ.",
        "РЁР°Рі 1 РёР· 3: РІРІРµРґРёС‚Рµ РґР°С‚Сѓ РЅР°С‡Р°Р»Р° РІ С„РѕСЂРјР°С‚Рµ Р”Р”.РњРњ.Р“Р“Р“Р“ (РёР»Рё Р”Р”.РњРњ.Р“Р“).",
        "РќР°РїСЂРёРјРµСЂ: 25.05.2026",
      ].join("\n"),
      {
        reply_markup: buildAdminClosePeriodStepKeyboard(),
      },
    );
    await context.answerCallbackQuery({ text: "Введите дату начала" });
  });

  bot.callbackQuery(/^adm:closeperiod:reopenpick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseReopenPickCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректный период",
        show_alert: true,
      });
      return;
    }

    try {
      const reopenResult = await dependencies.slotsApiService.reopenSlots({
        trainerTelegramId: dependencies.trainerTelegramId,
        startAt: parsed.startAt.toISOString(),
        endAt: parsed.endAt.toISOString(),
      });

      const hubView = await buildAdminClosePeriodsHubView(dependencies);
      await context.editMessageText(hubView.text, {
        reply_markup: hubView.keyboard,
      });
      await context.answerCallbackQuery({
        text: `Переоткрыто слотов: ${reopenResult.reopened}`,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ Р·Р°РєСЂС‹С‚РёРµ РїРѕ РєР°СЂС‚РѕС‡РєРµ", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось отменить закрытие",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:closeperiod:cancel", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    adminClosePeriodDraftByUser.delete(userId);
    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const adminSettingsView = await buildAdminSettingsView(dependencies);
    await context.editMessageText(adminSettingsView.text, {
      reply_markup: adminSettingsView.keyboard,
    });
    await context.answerCallbackQuery({ text: "Отменено" });
  });

  bot.callbackQuery("adm:slots:tpl:start", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const current = adminSlotsTemplateDraftByUser.get(userId);
    const draft: AdminSlotsTemplateDraft = current ?? {
      selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
      selectedHours: [],
      hoursPage: 0,
    };
    adminSlotsTemplateDraftByUser.set(userId, draft);

    await context.editMessageText(
      [
        "Панель админа > Даты и время > Шаблон на горизонт.",
        "",
        "Шаг 1 из 3: выберите дни недели.",
        "Шаблон применится ко всем датам текущего горизонта записи.",
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsTemplateWeekdaysKeyboard(draft.selectedWeekdays),
      },
    );
    await context.answerCallbackQuery({ text: "Выберите дни" });
  });

  bot.callbackQuery(/^adm:slots:tpl:wd:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const parsed = parseTemplateWeekdayCallback(context.callbackQuery.data);
    if (parsed === null) {
      await context.answerCallbackQuery({ text: "Некорректный день", show_alert: true });
      return;
    }

    const draft = adminSlotsTemplateDraftByUser.get(userId) ?? {
      selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
      selectedHours: [],
      hoursPage: 0,
    };

    if (parsed === "all") {
      draft.selectedWeekdays = [1, 2, 3, 4, 5, 6, 0];
    } else if (parsed === "none") {
      draft.selectedWeekdays = [];
    } else {
      draft.selectedWeekdays = toggleNumberInArray(draft.selectedWeekdays, parsed);
    }

    adminSlotsTemplateDraftByUser.set(userId, draft);
    await context.editMessageText(
      [
        "Панель админа > Даты и время > Шаблон на горизонт.",
        "",
        "Шаг 1 из 3: выберите дни недели.",
        `Выбрано дней: ${draft.selectedWeekdays.length}.`,
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsTemplateWeekdaysKeyboard(draft.selectedWeekdays),
      },
    );
    await context.answerCallbackQuery({ text: "Дни обновлены" });
  });

  bot.callbackQuery("adm:slots:tpl:hours", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const draft = adminSlotsTemplateDraftByUser.get(userId) ?? {
      selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
      selectedHours: [],
      hoursPage: 0,
    };

    if (draft.selectedWeekdays.length === 0) {
      await context.answerCallbackQuery({
        text: "Сначала выберите хотя бы один день недели",
        show_alert: true,
      });
      return;
    }

    draft.hoursPage = Math.max(0, draft.hoursPage);
    adminSlotsTemplateDraftByUser.set(userId, draft);

    await context.editMessageText(
      [
        "Панель админа > Даты и время > Шаблон на горизонт.",
        "",
        "Шаг 2 из 3: выберите часы.",
        `Выбрано дней: ${draft.selectedWeekdays.length}.`,
        `Выбрано часов: ${draft.selectedHours.length}.`,
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsTemplateHoursKeyboard(draft.selectedHours, draft.hoursPage),
      },
    );
    await context.answerCallbackQuery({ text: "Выберите часы" });
  });

  bot.callbackQuery(/^adm:slots:tpl:hrpage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const page = Number(context.callbackQuery.data.replace("adm:slots:tpl:hrpage:", "").trim());
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    const draft = adminSlotsTemplateDraftByUser.get(userId) ?? {
      selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
      selectedHours: [],
      hoursPage: 0,
    };
    draft.hoursPage = safePage;
    adminSlotsTemplateDraftByUser.set(userId, draft);

    await context.editMessageText(
      [
        "Панель админа > Даты и время > Шаблон на горизонт.",
        "",
        "Шаг 2 из 3: выберите часы.",
        `Выбрано дней: ${draft.selectedWeekdays.length}.`,
        `Выбрано часов: ${draft.selectedHours.length}.`,
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsTemplateHoursKeyboard(draft.selectedHours, draft.hoursPage),
      },
    );
    await context.answerCallbackQuery({ text: "Страница часов обновлена" });
  });

  bot.callbackQuery(/^adm:slots:tpl:hr:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const parsed = parseTemplateHourCallback(context.callbackQuery.data);
    if (parsed === null) {
      await context.answerCallbackQuery({ text: "Некорректный час", show_alert: true });
      return;
    }

    const draft = adminSlotsTemplateDraftByUser.get(userId) ?? {
      selectedWeekdays: [1, 2, 3, 4, 5, 6, 0],
      selectedHours: [],
      hoursPage: 0,
    };

    if (parsed === "all") {
      draft.selectedHours = getAdminVisibleHours();
    } else if (parsed === "none") {
      draft.selectedHours = [];
    } else {
      draft.selectedHours = toggleNumberInArray(draft.selectedHours, parsed);
    }

    adminSlotsTemplateDraftByUser.set(userId, draft);
    await context.editMessageText(
      [
        "Панель админа > Даты и время > Шаблон на горизонт.",
        "",
        "Шаг 2 из 3: выберите часы.",
        `Выбрано дней: ${draft.selectedWeekdays.length}.`,
        `Выбрано часов: ${draft.selectedHours.length}.`,
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsTemplateHoursKeyboard(draft.selectedHours, draft.hoursPage),
      },
    );
    await context.answerCallbackQuery({ text: "Часы обновлены" });
  });

  bot.callbackQuery("adm:slots:tpl:apply", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const draft = adminSlotsTemplateDraftByUser.get(userId);
    if (!draft || draft.selectedWeekdays.length === 0 || draft.selectedHours.length === 0) {
      await context.answerCallbackQuery({
        text: "Выберите минимум 1 день и 1 час",
        show_alert: true,
      });
      return;
    }

    try {
      const settingsResponse = await dependencies.trainerSettingsApiService.getCurrent();
      const horizonDays = settingsResponse.settings.bookingHorizonDays;
      const now = new Date();
      const nowParts = getMoscowDateParts(now);
      const horizonStart = getMoscowStartOfDayFromParts(
        Number(nowParts.year),
        Number(nowParts.month),
        Number(nowParts.day),
      );
      const horizonEnd = new Date(horizonStart.getTime() + horizonDays * 24 * 60 * 60 * 1000);

      const slots = await dependencies.slotsApiService.getTrainerSlots(
        dependencies.trainerTelegramId,
        horizonStart.toISOString(),
        horizonEnd.toISOString(),
      );

      const weekdaysSet = new Set(draft.selectedWeekdays);
      const hoursSet = new Set(draft.selectedHours);
      const openStarts: Date[] = [];
      const closeStarts: Date[] = [];
      let skippedBooked = 0;
      let unchangedOpen = 0;
      let unchangedClosed = 0;

      for (const slot of slots) {
        const startAt = new Date(slot.startAt);
        const weekday = getMoscowWeekdayIndex(startAt);
        const hour = getMoscowHourOfDay(startAt);
        const shouldBeOpen = isAdminVisibleHour(hour) && weekdaysSet.has(weekday) && hoursSet.has(hour);

        if (slot.status === "BOOKED") {
          skippedBooked += 1;
          continue;
        }

        if (shouldBeOpen) {
          if (slot.status === "OPEN") {
            unchangedOpen += 1;
          } else if (slot.status === "CLOSED") {
            openStarts.push(startAt);
          }
          continue;
        }

        if (slot.status === "OPEN") {
          closeStarts.push(startAt);
        } else if (slot.status === "CLOSED") {
          unchangedClosed += 1;
        }
      }

      const openRanges = buildHourRanges(openStarts);
      const closeRanges = buildHourRanges(closeStarts);
      let opened = 0;
      let closed = 0;

      for (const range of openRanges) {
        const result = await dependencies.slotsApiService.openSlots({
          trainerTelegramId: dependencies.trainerTelegramId,
          startAt: range.startAt.toISOString(),
          endAt: range.endAt.toISOString(),
        });
        opened += result.created + result.reopened;
      }

      for (const range of closeRanges) {
        const result = await dependencies.slotsApiService.closeSlots({
          trainerTelegramId: dependencies.trainerTelegramId,
          startAt: range.startAt.toISOString(),
          endAt: range.endAt.toISOString(),
          reason: ADMIN_SLOT_TEMPLATE_CLOSE_REASON,
        });
        closed += result.closed;
      }

      const weekdayLabels = draft.selectedWeekdays
        .sort((left, right) => left - right)
        .map((weekday) => getWeekdayLabel(weekday))
        .join(", ");
      const hoursLabels = draft.selectedHours
        .sort((left, right) => left - right)
        .map((hour) => `${String(hour).padStart(2, "0")}:00`)
        .join(", ");

      adminSlotsTemplateDraftByUser.delete(userId);

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Шаблон на горизонт.",
          "",
          "Шаг 3 из 3: шаблон применен.",
          `Горизонт: ${horizonDays} дн.`,
          `Дни недели: ${weekdayLabels}.`,
          `Часы: ${hoursLabels}.`,
          "",
          "Итог:",
          `Открыто слотов: ${opened}.`,
          `Закрыто слотов: ${closed}.`,
          `Без изменений (уже открыто): ${unchangedOpen}.`,
          `Без изменений (уже закрыто): ${unchangedClosed}.`,
          skippedBooked > 0 ? `Пропущено занятых: ${skippedBooked}.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          reply_markup: new InlineKeyboard()
            .text("Новый шаблон", "adm:slots:tpl:start")
            .row()
            .text("К датам", "screen:admin-slots")
            .row()
            .text("< В настройки", "screen:admin-settings"),
        },
      );

      await context.answerCallbackQuery({ text: "Шаблон применен" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ С€Р°Р±Р»РѕРЅ СЃР»РѕС‚РѕРІ РЅР° РіРѕСЂРёР·РѕРЅС‚", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось применить шаблон", show_alert: true });
    }
  });

  bot.callbackQuery("adm:slots:tpl:cancel", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    adminSlotsTemplateDraftByUser.delete(userId);
    try {
      const view = await buildAdminSlotsView(dependencies, 0);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Шаблон отменен" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ СЂРµР¶РёРј С€Р°Р±Р»РѕРЅР°", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось вернуть список дат", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:startmode:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const pageRaw = context.callbackQuery.data.replace("adm:slots:range:startmode:", "").trim();
    const page = Number(pageRaw);
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    try {
      const dateSummaries = await getAdminDateSummaries(dependencies);
      adminSlotsRangeDraftByUser.set(userId, { step: "pick_start" });
      const paging = getPaging(dateSummaries, safePage, ADMIN_SLOTS_GRID_PAGE_SIZE);

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          "Шаг 1 из 3: выберите дату начала диапазона.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildAdminSlotsRangeStartKeyboard(dateSummaries, paging.currentPage),
        },
      );
      await context.answerCallbackQuery({ text: "Выберите дату начала" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІС‹Р±РѕСЂ РґР°С‚С‹ РЅР°С‡Р°Р»Р° РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        page: safePage,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось открыть выбор диапазона", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:startpage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const page = Number(context.callbackQuery.data.replace("adm:slots:range:startpage:", "").trim());
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    try {
      const dateSummaries = await getAdminDateSummaries(dependencies);
      adminSlotsRangeDraftByUser.set(userId, { step: "pick_start" });
      const paging = getPaging(dateSummaries, safePage, ADMIN_SLOTS_GRID_PAGE_SIZE);

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          "Шаг 1 из 3: выберите дату начала диапазона.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildAdminSlotsRangeStartKeyboard(dateSummaries, paging.currentPage),
        },
      );
      await context.answerCallbackQuery({ text: "Страница обновлена" });
    } catch (error) {
      const normalizedError = error as Error;
      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }

      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР»РёСЃС‚Р°С‚СЊ РґР°С‚С‹ РЅР°С‡Р°Р»Р° РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        page: safePage,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось обновить страницу", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:startpick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const startDateKey = context.callbackQuery.data.replace("adm:slots:range:startpick:", "").trim();
    if (!parseAdminSlotsDateKey(startDateKey)) {
      await context.answerCallbackQuery({ text: "Некорректная дата начала", show_alert: true });
      return;
    }

    try {
      const dateSummaries = await getAdminDateSummaries(dependencies);
      adminSlotsRangeDraftByUser.set(userId, { step: "pick_end", startDateKey });

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          `Шаг 2 из 3: выберите дату окончания диапазона (от ${getDateLabelByKey(startDateKey)}).`,
        ].join("\n"),
        {
          reply_markup: buildAdminSlotsRangeEndKeyboard(dateSummaries, startDateKey, 0),
        },
      );
      await context.answerCallbackQuery({ text: "Выберите дату окончания" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІС‹Р±РѕСЂ РґР°С‚С‹ РѕРєРѕРЅС‡Р°РЅРёСЏ РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        startDateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось продолжить выбор диапазона", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:endpage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const draft = adminSlotsRangeDraftByUser.get(userId);
    if (!draft?.startDateKey) {
      await context.answerCallbackQuery({ text: "Сначала выберите дату начала", show_alert: true });
      return;
    }

    const page = Number(context.callbackQuery.data.replace("adm:slots:range:endpage:", "").trim());
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    try {
      const dateSummaries = await getAdminDateSummaries(dependencies);
      const filtered = dateSummaries.filter((item) => compareDateKeys(item.dateKey, draft.startDateKey as string) >= 0);
      const paging = getPaging(filtered, safePage, ADMIN_SLOTS_GRID_PAGE_SIZE);

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          `Шаг 2 из 3: выберите дату окончания (от ${getDateLabelByKey(draft.startDateKey)}).`,
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildAdminSlotsRangeEndKeyboard(dateSummaries, draft.startDateKey, paging.currentPage),
        },
      );
      await context.answerCallbackQuery({ text: "Страница обновлена" });
    } catch (error) {
      const normalizedError = error as Error;
      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР»РёСЃС‚Р°С‚СЊ РґР°С‚С‹ РѕРєРѕРЅС‡Р°РЅРёСЏ РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        page: safePage,
        startDateKey: draft.startDateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось обновить страницу", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:endpick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const draft = adminSlotsRangeDraftByUser.get(userId);
    if (!draft?.startDateKey) {
      await context.answerCallbackQuery({ text: "Сначала выберите дату начала", show_alert: true });
      return;
    }

    const endDateKey = context.callbackQuery.data.replace("adm:slots:range:endpick:", "").trim();
    if (!parseAdminSlotsDateKey(endDateKey)) {
      await context.answerCallbackQuery({ text: "Некорректная дата окончания", show_alert: true });
      return;
    }

    const sorted = sortRangeKeys(draft.startDateKey, endDateKey);
    adminSlotsRangeDraftByUser.set(userId, {
      step: "pick_action",
      startDateKey: sorted.startDateKey,
      endDateKey: sorted.endDateKey,
    });

    await context.editMessageText(
      [
        "Панель админа > Даты и время > Массовое изменение.",
        "",
        "Шаг 3 из 3: выберите действие для диапазона.",
        `Диапазон: ${getDateLabelByKey(sorted.startDateKey)} — ${getDateLabelByKey(sorted.endDateKey)}.`,
      ].join("\n"),
      {
        reply_markup: buildAdminSlotsRangeActionKeyboard(sorted.startDateKey, sorted.endDateKey),
      },
    );
    await context.answerCallbackQuery({ text: "Выберите действие" });
  });

  bot.callbackQuery("adm:slots:range:restart", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    try {
      const dateSummaries = await getAdminDateSummaries(dependencies);
      adminSlotsRangeDraftByUser.set(userId, { step: "pick_start" });
      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          "Шаг 1 из 3: выберите дату начала диапазона.",
        ].join("\n"),
        {
          reply_markup: buildAdminSlotsRangeStartKeyboard(dateSummaries, 0),
        },
      );
      await context.answerCallbackQuery({ text: "Выберите дату начала" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµР·Р°РїСѓСЃС‚РёС‚СЊ РІС‹Р±РѕСЂ РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось открыть выбор диапазона", show_alert: true });
    }
  });

  bot.callbackQuery("adm:slots:range:cancel", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
    try {
      const view = await buildAdminSlotsView(dependencies, 0);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Массовое изменение отменено" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ СЂРµР¶РёРј РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось вернуть список дат", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:range:apply:(open|close):/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({ text: "Раздел доступен только тренеру", show_alert: true });
      return;
    }

    const parsed = parseAdminSlotsRangeApplyCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({ text: "Некорректные данные диапазона", show_alert: true });
      return;
    }

    const startRange = getMoscowDayRangeByKey(parsed.startDateKey);
    const endRange = getMoscowDayRangeByKey(parsed.endDateKey);
    if (!startRange || !endRange) {
      await context.answerCallbackQuery({ text: "Некорректная дата диапазона", show_alert: true });
      return;
    }

    try {
      const slots = await dependencies.slotsApiService.getTrainerSlots(
        dependencies.trainerTelegramId,
        startRange.start.toISOString(),
        endRange.end.toISOString(),
      );
      const visibleSlots = filterAdminVisibleSlots(slots);
      const startsToChange = visibleSlots
        .filter((slot) => slot.status !== "BOOKED")
        .filter((slot) => (parsed.action === "open" ? slot.status === "CLOSED" : slot.status === "OPEN"))
        .map((slot) => new Date(slot.startAt));

      for (const range of buildHourRanges(startsToChange)) {
        if (parsed.action === "open") {
          await dependencies.slotsApiService.openSlots({
            trainerTelegramId: dependencies.trainerTelegramId,
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
          });
        } else {
          await dependencies.slotsApiService.closeSlots({
            trainerTelegramId: dependencies.trainerTelegramId,
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
            reason: ADMIN_SLOT_FORCE_CLOSE_REASON,
          });
        }
      }

      const updatedSlots = await dependencies.slotsApiService.getTrainerSlots(
        dependencies.trainerTelegramId,
        startRange.start.toISOString(),
        endRange.end.toISOString(),
      );
      const updatedVisibleSlots = filterAdminVisibleSlots(updatedSlots);
      const openCount = updatedVisibleSlots.filter((slot) => slot.status === "OPEN").length;
      const closedCount = updatedVisibleSlots.filter((slot) => slot.status === "CLOSED").length;
      const bookedCount = updatedVisibleSlots.filter((slot) => slot.status === "BOOKED").length;
      const daysCount = Math.round((endRange.end.getTime() - startRange.start.getTime()) / (24 * 60 * 60 * 1000));

      adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);

      await context.editMessageText(
        [
          "Панель админа > Даты и время > Массовое изменение.",
          "",
          `Готово: ${parsed.action === "open" ? "диапазон открыт" : "диапазон закрыт"}.`,
          `Диапазон: ${getDateLabelByKey(parsed.startDateKey)} — ${getDateLabelByKey(parsed.endDateKey)}.`,
          `Дней в диапазоне: ${daysCount}.`,
          `Итог по слотам: открыто ${openCount}, закрыто ${closedCount}, занято ${bookedCount}.`,
        ].join("\n"),
        {
          reply_markup: new InlineKeyboard()
            .text("Еще массовое изменение", "adm:slots:range:startmode:0")
            .row()
            .text("К датам", "screen:admin-slots")
            .row()
            .text("< В настройки", "screen:admin-settings"),
        },
      );

      await context.answerCallbackQuery({ text: "Диапазон обновлен" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РјР°СЃСЃРѕРІРѕРµ РёР·РјРµРЅРµРЅРёРµ РґРёР°РїР°Р·РѕРЅР°", {
        userId,
        action: parsed.action,
        startDateKey: parsed.startDateKey,
        endDateKey: parsed.endDateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось применить изменение", show_alert: true });
    }
  });

  bot.callbackQuery(/^adm:slots:page:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const page = Number(context.callbackQuery.data.replace("adm:slots:page:", "").trim());
    const safePage = Number.isInteger(page) && page >= 0 ? page : 0;

    try {
      const view = await buildAdminSlotsView(dependencies, safePage);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Список дат обновлен" });
    } catch (error) {
      const normalizedError = error as Error;
      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }

      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє РґР°С‚ Рё РІСЂРµРјРµРЅРё", {
        userId,
        page: safePage,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось обновить список дат",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:slots:date:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const dateKey = context.callbackQuery.data.replace("adm:slots:date:", "").trim();
    if (!parseAdminSlotsDateKey(dateKey)) {
      await context.answerCallbackQuery({
        text: "Некорректная дата",
        show_alert: true,
      });
      return;
    }

    try {
      const dayView = await buildAdminSlotsDayView(dependencies, dateKey);
      await context.editMessageText(dayView.text, {
        reply_markup: dayView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Дата открыта" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РґР°С‚Сѓ РІ СЂР°Р·РґРµР»Рµ СЃР»РѕС‚РѕРІ", {
        userId,
        dateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось открыть дату",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:slots:toggle:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseAdminSlotsToggleCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректные данные часа",
        show_alert: true,
      });
      return;
    }

    const dayRange = getMoscowDayRangeByKey(parsed.dateKey);
    if (!dayRange) {
      await context.answerCallbackQuery({
        text: "Некорректная дата",
        show_alert: true,
      });
      return;
    }

    const slotStart = new Date(dayRange.start.getTime() + parsed.hour * 60 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

    try {
      const daySlots = await dependencies.slotsApiService.getTrainerSlots(
        dependencies.trainerTelegramId,
        dayRange.start.toISOString(),
        dayRange.end.toISOString(),
      );
      const currentSlot = daySlots.find((slot) => getMoscowHour(new Date(slot.startAt)) === parsed.hour);
      if (!currentSlot) {
        await context.answerCallbackQuery({
          text: "Слот не найден",
          show_alert: true,
        });
        return;
      }

      if (currentSlot.status === "BOOKED") {
        await context.answerCallbackQuery({
          text: "Этот слот уже занят, его нельзя изменить",
          show_alert: true,
        });
        return;
      }

      if (currentSlot.status === "CLOSED") {
        await dependencies.slotsApiService.openSlots({
          trainerTelegramId: dependencies.trainerTelegramId,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
        });
      } else {
        await dependencies.slotsApiService.closeSlots({
          trainerTelegramId: dependencies.trainerTelegramId,
          startAt: slotStart.toISOString(),
          endAt: slotEnd.toISOString(),
          reason: ADMIN_SLOT_FORCE_CLOSE_REASON,
        });
      }

      const dayView = await buildAdminSlotsDayView(dependencies, parsed.dateKey);
      await context.editMessageText(dayView.text, {
        reply_markup: dayView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Слот обновлен" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРєР»СЋС‡РёС‚СЊ СЃС‚Р°С‚СѓСЃ СЃР»РѕС‚Р° РІ РїР°РЅРµР»Рё РґР°С‚ Рё РІСЂРµРјРµРЅРё", {
        userId,
        dateKey: parsed.dateKey,
        hour: parsed.hour,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось обновить слот",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:slots:day:(open|close):/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseAdminSlotsDayActionCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректное действие",
        show_alert: true,
      });
      return;
    }

    const dayRange = getMoscowDayRangeByKey(parsed.dateKey);
    if (!dayRange) {
      await context.answerCallbackQuery({
        text: "Некорректная дата",
        show_alert: true,
      });
      return;
    }

    try {
      const daySlots = await dependencies.slotsApiService.getTrainerSlots(
        dependencies.trainerTelegramId,
        dayRange.start.toISOString(),
        dayRange.end.toISOString(),
      );
      const visibleSlots = filterAdminVisibleSlots(daySlots).filter((slot) => slot.status !== "BOOKED");
      const startsToChange = visibleSlots
        .filter((slot) => (parsed.action === "open" ? slot.status === "CLOSED" : slot.status === "OPEN"))
        .map((slot) => new Date(slot.startAt));

      for (const range of buildHourRanges(startsToChange)) {
        if (parsed.action === "open") {
          await dependencies.slotsApiService.openSlots({
            trainerTelegramId: dependencies.trainerTelegramId,
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
          });
        } else {
          await dependencies.slotsApiService.closeSlots({
            trainerTelegramId: dependencies.trainerTelegramId,
            startAt: range.startAt.toISOString(),
            endAt: range.endAt.toISOString(),
            reason: ADMIN_SLOT_FORCE_CLOSE_REASON,
          });
        }
      }

      const dayView = await buildAdminSlotsDayView(dependencies, parsed.dateKey);
      await context.editMessageText(dayView.text, {
        reply_markup: dayView.keyboard,
      });
      await context.answerCallbackQuery({
        text: parsed.action === "open" ? "День открыт" : "День закрыт",
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ СЃРѕСЃС‚РѕСЏРЅРёРµ РґРЅСЏ РІ РїР°РЅРµР»Рё РґР°С‚ Рё РІСЂРµРјРµРЅРё", {
        userId,
        action: parsed.action,
        dateKey: parsed.dateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось изменить день",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:search", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    adminClosePeriodDraftByUser.delete(userId);
    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
    adminClientSearchModeUsers.add(userId);
    await context.editMessageText(
      [
        "Панель админа > Поиск клиента.",
        "",
        "Введите в чат имя или телефон клиента.",
        "Пример: Анна или 79991234567",
      ].join("\n"),
      {
        reply_markup: buildAdminSearchModeKeyboard(),
      },
    );
    await context.answerCallbackQuery({ text: "Режим поиска включен" });
  });

  bot.callbackQuery("adm:settings:search:stop", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    adminClientSearchModeUsers.delete(userId);
    adminSlotsRangeDraftByUser.delete(userId);
    adminSlotsTemplateDraftByUser.delete(userId);
    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const adminSettingsView = await buildAdminSettingsView(dependencies);
    await context.editMessageText(adminSettingsView.text, {
      reply_markup: adminSettingsView.keyboard,
    });
    await context.answerCallbackQuery({ text: "Режим поиска выключен" });
  });

  bot.callbackQuery("adm:blacklist:refresh", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const view = await buildAdminBlacklistView(dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Список обновлен" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ С‡РµСЂРЅС‹Р№ СЃРїРёСЃРѕРє", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Не удалось обновить список",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:blacklist:rm:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const clientId = parseBlacklistRemoveCallback(context.callbackQuery.data);
    if (!clientId) {
      await context.answerCallbackQuery({
        text: "Некорректный клиент",
        show_alert: true,
      });
      return;
    }

    try {
      const result = await dependencies.clientsApiService.removeFromBlacklist(clientId);
      const view = await buildAdminBlacklistView(dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({
        text: result.status === "removed" ? "Клиент удален из ЧС" : "Клиент уже не в ЧС",
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РєР»РёРµРЅС‚Р° РёР· С‡РµСЂРЅРѕРіРѕ СЃРїРёСЃРєР°", {
        userId,
        clientId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ РёР· Р§РЎ",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:settings:refresh", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    const staticView = buildScreenView("admin-settings", role);
    const adminSettingsView = await buildAdminSettingsView(dependencies);
    await context.editMessageText(adminSettingsView.text || staticView.text, {
      reply_markup: adminSettingsView.keyboard,
    });
    await context.answerCallbackQuery({ text: "Обновлено" });
  });

  bot.callbackQuery(/^adm:req:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:req:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(bookingId);
      await context.editMessageText(buildBookingDetailsText(booking), {
        parse_mode: "HTML",
        reply_markup: buildAdminBookingActionsKeyboard(booking),
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РєР°СЂС‚РѕС‡РєСѓ Р·Р°СЏРІРєРё", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:confirm:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:confirm:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.confirmBooking({ bookingId });
      const start = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));

      await context.answerCallbackQuery({ text: "Заявка подтверждена" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Заявка подтверждена: ${result.booking.client.fullName}, ${start} (МСК).`,
      );
      try {
        await sendOrReplaceClientNotice(
          context.api,
          result.booking.client.telegramId,
          [
            "Ваша заявка подтверждена.",
            `Тренировка: ${start} (МСК).`,
            "До встречи на тренировке.",
          ].join("\n"),
          buildClientQuickActionsKeyboard(),
        );
        await sendClientCalendarInvite(context.api, result.booking.client.telegramId, result.booking);
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРё", {
          bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґС‚РІРµСЂРґРёС‚СЊ Р·Р°СЏРІРєСѓ", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:reject:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:reject:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.rejectBooking({
        bookingId,
        trainerComment: DEFAULT_REJECT_COMMENT,
      });

      const start = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));
      await context.answerCallbackQuery({ text: "Заявка отклонена" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Заявка отклонена: ${result.booking.client.fullName}, ${start} (МСК).`,
      );
      try {
        await sendOrReplaceClientNotice(
          context.api,
          result.booking.client.telegramId,
          [
            "К сожалению, заявка отклонена.",
            `Запрошенное время: ${start} (МСК).`,
            `Комментарий тренера: ${DEFAULT_REJECT_COMMENT}`,
          ].join("\n"),
          buildClientQuickActionsKeyboard(),
        );
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ РѕР± РѕС‚РєР»РѕРЅРµРЅРёРё", {
          bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєР»РѕРЅРёС‚СЊ Р·Р°СЏРІРєСѓ", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:cancel:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:cancel:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.cancelTraining({
        bookingId,
        trainerComment: DEFAULT_CANCEL_COMMENT,
      });
      const start = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));

      await context.answerCallbackQuery({ text: "Тренировка отменена" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Тренировка отменена: ${result.booking.client.fullName}, ${start} (МСК).`,
      );

      try {
        await sendOrReplaceClientNotice(
          context.api,
          result.booking.client.telegramId,
          [
            "Тренировка отменена тренером.",
            `Время: ${start} (МСК).`,
            `Комментарий тренера: ${DEFAULT_CANCEL_COMMENT}`,
          ].join("\n"),
          buildClientQuickActionsKeyboard(),
        );
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ РѕР± РѕС‚РјРµРЅРµ С‚СЂРµРЅРёСЂРѕРІРєРё", {
          bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ РїРѕРґС‚РІРµСЂР¶РґРµРЅРЅСѓСЋ С‚СЂРµРЅРёСЂРѕРІРєСѓ", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:resync:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:resync:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(bookingId);
      if (booking.status !== "CONFIRMED") {
        await context.answerCallbackQuery({
          text: "Пересинхронизация доступна только для подтвержденной тренировки",
          show_alert: true,
        });
        return;
      }

      const result = await dependencies.bookingsApiService.resyncCalendar({ bookingId });
      const start = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));

      await context.answerCallbackQuery({ text: "Календарь пересинхронизирован" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Пересинхронизация выполнена: ${result.booking.client.fullName}, ${start} (МСК).`,
      );

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РІС‹РїРѕР»РЅРёС‚СЊ СЂСѓС‡РЅСѓСЋ РїРµСЂРµСЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЋ РєР°Р»РµРЅРґР°СЂСЏ", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:move:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:move:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(bookingId);
      if (booking.status !== "CONFIRMED") {
        await context.answerCallbackQuery({
          text: "Перенос доступен только для подтвержденной заявки",
          show_alert: true,
        });
        return;
      }

      const allSlots = await dependencies.slotsApiService.getAvailableSlots(booking.client.telegramId);
      const suggestedSlots = allSlots.filter((slot) => slot.startAt !== booking.slot.startAt);

      if (suggestedSlots.length === 0) {
        await context.answerCallbackQuery({
          text: "Нет доступных слотов для переноса",
          show_alert: true,
        });
        return;
      }

      const page = 0;
      const totalPages = Math.max(1, Math.ceil(suggestedSlots.length / MOVE_PAGE_SIZE));

      await context.editMessageText(
        [
          "Перенос подтвержденной тренировки.",
          "",
          `Клиент: ${booking.client.fullName}`,
          `Страница ${page + 1} из ${totalPages}.`,
          "",
          "Выбери новое время:",
        ].join("\n"),
        {
          reply_markup: buildMoveSlotsKeyboard(booking.id, suggestedSlots, page),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РїРµСЂРµРЅРѕСЃ РїРѕРґС‚РІРµСЂР¶РґРµРЅРЅРѕР№ С‚СЂРµРЅРёСЂРѕРІРєРё", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:forceclose:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:forceclose:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.forceCloseBooking({
        bookingId,
        trainerComment: DEFAULT_FORCE_CLOSE_COMMENT,
      });

      const start = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));
      const actionText =
        result.booking.status === "CONFIRMED"
          ? "Предложение закрыто, сохранено текущее подтвержденное время"
          : "Заявка закрыта";
      await context.answerCallbackQuery({ text: actionText });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `${actionText}: ${result.booking.client.fullName}, ${start} (МСК).`,
      );

      try {
        if (result.booking.status === "CONFIRMED") {
          await sendOrReplaceClientNotice(
            context.api,
            result.booking.client.telegramId,
            [
              "Предложение переноса закрыто тренером.",
              "Остается текущее подтвержденное время тренировки.",
            ].join("\n"),
            buildClientQuickActionsKeyboard(),
          );
        } else {
          await sendOrReplaceClientNotice(
            context.api,
            result.booking.client.telegramId,
            [
              "Ваша заявка закрыта тренером.",
              `Время: ${start} (МСК).`,
              `Комментарий тренера: ${DEFAULT_FORCE_CLOSE_COMMENT}`,
            ].join("\n"),
            buildClientQuickActionsKeyboard(),
          );
        }
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ СЂСѓС‡РЅРѕРј Р·Р°РєСЂС‹С‚РёРё Р·Р°СЏРІРєРё", {
          bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РІСЂСѓС‡РЅСѓСЋ Р·Р°РєСЂС‹С‚СЊ Р·Р°СЏРІРєСѓ", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:movepage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseMovePageCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Не удалось открыть страницу переноса",
        show_alert: true,
      });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(parsed.bookingId);
      if (booking.status !== "CONFIRMED") {
        await context.answerCallbackQuery({
          text: "Перенос доступен только для подтвержденной заявки",
          show_alert: true,
        });
        return;
      }

      const allSlots = await dependencies.slotsApiService.getAvailableSlots(booking.client.telegramId);
      const suggestedSlots = allSlots.filter((slot) => slot.startAt !== booking.slot.startAt);
      if (suggestedSlots.length === 0) {
        await context.answerCallbackQuery({
          text: "Нет доступных слотов для переноса",
          show_alert: true,
        });
        return;
      }

      const totalPages = Math.max(1, Math.ceil(suggestedSlots.length / MOVE_PAGE_SIZE));
      const page = Math.max(0, Math.min(parsed.page, totalPages - 1));
      const startIndex = page * MOVE_PAGE_SIZE;
      await context.editMessageText(
        [
          "Перенос подтвержденной тренировки.",
          "",
          `Клиент: ${booking.client.fullName}`,
          `Страница ${page + 1} из ${totalPages}.`,
          "",
          "Выбери новое время:",
        ].join("\n"),
        {
          reply_markup: buildMoveSlotsKeyboard(booking.id, suggestedSlots, page),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ СЃС‚СЂР°РЅРёС†Сѓ РїРµСЂРµРЅРѕСЃР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРЅРѕР№ С‚СЂРµРЅРёСЂРѕРІРєРё", {
        userId,
        bookingId: parsed.bookingId,
        page: parsed.page,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:archive:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:archive:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(bookingId);

      if (booking.status === "PENDING" || booking.status === "RESCHEDULED") {
        await dependencies.bookingsApiService.forceCloseBooking({
          bookingId,
          trainerComment: "Заявка удалена тренером из списка.",
        });
      } else if (booking.status === "CONFIRMED") {
        await dependencies.bookingsApiService.cancelTraining({
          bookingId,
          trainerComment: "Тренировка удалена тренером из списка.",
        });
      }

      await dependencies.bookingsApiService.archiveBookingByTrainer({ bookingId });

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Заявка удалена" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("Не удалось удалить заявку тренером", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:propose:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const bookingId = parseBookingIdFromCallback(context.callbackQuery.data, "adm:propose:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная заявка", show_alert: true });
      return;
    }

    try {
      const booking = await dependencies.bookingsApiService.getBookingDetails(bookingId);
      const allSlots = await dependencies.slotsApiService.getAvailableSlots(booking.client.telegramId);
      const suggestedSlots = allSlots
        .filter((slot) => slot.startAt !== booking.slot.startAt)
        .slice(0, MAX_PROPOSAL_SLOTS_TO_SHOW);

      if (suggestedSlots.length === 0) {
        await context.answerCallbackQuery({
          text: "Нет доступных слотов для предложения",
          show_alert: true,
        });
        return;
      }

      const lines = suggestedSlots.map((slot, index) => {
        return `${index + 1}. ${slotTimeFormatter.format(new Date(slot.startAt))}`;
      });

      await context.editMessageText(
        [
          "Выбор альтернативного времени.",
          "",
          `Клиент: ${booking.client.fullName}`,
          `Текущий слот: ${slotTimeFormatter.format(new Date(booking.slot.startAt))}`,
          "",
          "Выбери новый вариант времени:",
          ...lines,
        ].join("\n"),
        {
          reply_markup: buildProposeSlotsKeyboard(booking.id, suggestedSlots),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІС‹Р±РѕСЂ Р°Р»СЊС‚РµСЂРЅР°С‚РёРІРЅРѕРіРѕ РІСЂРµРјРµРЅРё", {
        userId,
        bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:proposepick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseProposePickCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректные данные предложения",
        show_alert: true,
      });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.proposeTime({
        bookingId: parsed.bookingId,
        proposedStartAt: parsed.proposedStartAt.toISOString(),
        trainerComment: DEFAULT_PROPOSE_COMMENT,
      });

      const start = adminDateTimeFormatter.format(parsed.proposedStartAt);
      await context.answerCallbackQuery({ text: "Предложение отправлено" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Клиенту предложено новое время: ${result.booking.client.fullName}, ${start} (МСК).`,
      );
      try {
        await sendOrReplaceClientNotice(
          context.api,
          result.booking.client.telegramId,
          [
            "Тренер предложил другое время для тренировки.",
            `Новый вариант: ${start} (МСК).`,
            `Комментарий тренера: ${DEFAULT_PROPOSE_COMMENT}`,
            "",
            "Подтверди, пожалуйста, подходит ли это время:",
          ].join("\n"),
          buildClientProposalDecisionKeyboard(result.booking.id),
        );
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ РїРµСЂРµРЅРѕСЃРµ", {
          bookingId: parsed.bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРµРґР»РѕР¶РёС‚СЊ РґСЂСѓРіРѕРµ РІСЂРµРјСЏ", {
        userId,
        bookingId: parsed.bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^adm:movepick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    const parsed = parseMovePickCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректные данные переноса",
        show_alert: true,
      });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.rescheduleTraining({
        bookingId: parsed.bookingId,
        newStartAt: parsed.newStartAt.toISOString(),
        trainerComment: DEFAULT_RESCHEDULE_COMMENT,
      });

      const newStartText = adminDateTimeFormatter.format(parsed.newStartAt);
      await context.answerCallbackQuery({ text: "Предложение отправлено" });
      await sendOrReplaceAdminNotice(
        context.api,
        String(userId),
        `Клиенту отправлено предложение переноса: ${result.booking.client.fullName}, ${newStartText} (МСК).`,
      );

      try {
        await sendOrReplaceClientNotice(
          context.api,
          result.booking.client.telegramId,
          [
            "Тренер предложил перенос подтвержденной тренировки.",
            `Новый вариант: ${newStartText} (МСК).`,
            `Комментарий тренера: ${DEFAULT_RESCHEDULE_COMMENT}`,
            "",
            "Подтверди, пожалуйста, подходит ли это время:",
          ].join("\n"),
          buildClientProposalDecisionKeyboard(result.booking.id),
        );
      } catch (notifyError) {
        const normalizedNotifyError = notifyError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ РїРµСЂРµРЅРѕСЃРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРЅРѕР№ С‚СЂРµРЅРёСЂРѕРІРєРё", {
          bookingId: parsed.bookingId,
          clientTelegramId: result.booking.client.telegramId,
          message: normalizedNotifyError.message,
        });
      }

      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРЅРµСЃС‚Рё РїРѕРґС‚РІРµСЂР¶РґРµРЅРЅСѓСЋ С‚СЂРµРЅРёСЂРѕРІРєСѓ", {
        userId,
        bookingId: parsed.bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getAdminActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("adm:requests:refresh", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);
    if (role !== "admin") {
      await context.answerCallbackQuery({
        text: "Раздел доступен только тренеру",
        show_alert: true,
      });
      return;
    }

    try {
      const adminView = await buildAdminRequestsView(dependencies);
      await context.editMessageText(adminView.text, {
        reply_markup: adminView.keyboard,
      });
      await context.answerCallbackQuery({ text: "Список обновлен" });
    } catch (error) {
      const normalizedError = error as Error;

      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }

      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє Р·Р°СЏРІРѕРє", {
        userId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: "Не удалось обновить список",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("cli:tr:refresh", async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    try {
      const view = await buildClientTrainingsView(
        userId,
        "Мои тренировки.",
        dependencies,
      );
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Список обновлен" });
    } catch (error) {
      const normalizedError = error as Error;
      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Список уже актуален" });
        return;
      }
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЃРїРёСЃРѕРє С‚СЂРµРЅРёСЂРѕРІРѕРє РєР»РёРµРЅС‚Р°", {
        userId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось обновить список", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:view:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const bookingId = parseClientTrainingBookingId(context.callbackQuery.data, "cli:tr:view:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная тренировка", show_alert: true });
      return;
    }

    try {
      const response = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const item = response.items.find((entry) => entry.bookingId === bookingId);
      if (!item) {
        await context.answerCallbackQuery({ text: "Запись не найдена", show_alert: true });
        return;
      }

      await context.editMessageText(
        [
          "Моя тренировка.",
          "",
          `Статус: ${getClientTrainingStatusLabel(item)}`,
          `Время: ${adminDateTimeFormatter.format(new Date(item.startAt))} (МСК)`,
          item.trainerComment ? `Комментарий тренера: ${item.trainerComment}` : "",
          item.clientComment ? `Ваш комментарий: ${item.clientComment}` : "",
          "",
          "Доступные действия ниже.",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          reply_markup: buildClientTrainingCardKeyboard(item),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      if (isMessageNotModifiedError(normalizedError)) {
        await context.answerCallbackQuery({ text: "Карточка уже открыта" });
        return;
      }
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РєР°СЂС‚РѕС‡РєСѓ С‚СЂРµРЅРёСЂРѕРІРєРё РєР»РёРµРЅС‚Р°", {
        userId,
        bookingId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось открыть тренировку", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:archive:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const bookingId = parseClientTrainingBookingId(context.callbackQuery.data, "cli:tr:archive:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная тренировка", show_alert: true });
      return;
    }

    try {
      await dependencies.bookingsApiService.archiveTrainingByClient({
        telegramId: String(userId),
        bookingId,
      });

      const view = await buildClientTrainingsView(userId, "Мои тренировки.", dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
      await context.answerCallbackQuery({ text: "Запись удалена из списка" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ СѓРґР°Р»РёС‚СЊ С‚СЂРµРЅРёСЂРѕРІРєСѓ РёР· РєР»РёРµРЅС‚СЃРєРѕРіРѕ СЃРїРёСЃРєР°", {
        userId,
        bookingId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: "Пока нельзя удалить эту запись",
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^cli:tr:cancel:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const bookingId = parseClientTrainingBookingId(context.callbackQuery.data, "cli:tr:cancel:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная тренировка", show_alert: true });
      return;
    }

    try {
      const result = await dependencies.bookingsApiService.cancelTrainingByClient({
        telegramId: String(userId),
        bookingId,
      });

      const slotStartText = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));
      await context.answerCallbackQuery({ text: "Тренировка отменена" });
      await sendOrReplaceClientNotice(
        context.api,
        String(userId),
        [
          "Вы отменили тренировку.",
          `Было запланировано: ${slotStartText} (МСК).`,
        ].join("\n"),
        buildClientQuickActionsKeyboard(),
      );

      const recipients = getAdminNotificationRecipients(dependencies);
      for (const recipient of recipients) {
        try {
          await sendOrReplaceAdminNotice(
            context.api,
            recipient,
            `Клиент ${result.booking.client.fullName} отменил тренировку: ${slotStartText} (МСК).`,
          );
        } catch (notifyError) {
          const normalizedNotifyError = notifyError as Error;
          dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ СѓРІРµРґРѕРјРёС‚СЊ С‚СЂРµРЅРµСЂР° РѕР± РѕС‚РјРµРЅРµ РєР»РёРµРЅС‚РѕРј", {
            bookingId,
            recipient,
            message: normalizedNotifyError.message,
          });
        }
      }

      const view = await buildClientTrainingsView(userId, "Мои тренировки.", dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ С‚СЂРµРЅРёСЂРѕРІРєСѓ РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: getBookingErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^cli:tr:move:start:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const bookingId = parseClientTrainingBookingId(context.callbackQuery.data, "cli:tr:move:start:");
    if (!bookingId) {
      await context.answerCallbackQuery({ text: "Некорректная тренировка", show_alert: true });
      return;
    }

    try {
      const trainings = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const current = trainings.items.find((entry) => entry.bookingId === bookingId);
      if (!current || !current.canReschedule) {
        await context.answerCallbackQuery({ text: "Перенос сейчас недоступен", show_alert: true });
        return;
      }

      const slots = filterAdminVisibleSlots(await dependencies.slotsApiService.getAvailableSlots(String(userId)));
      const groups = buildDateSlotsGroups(
        slots.filter((slot) => slot.startAt !== current.startAt),
      );
      if (groups.length === 0) {
        await context.answerCallbackQuery({ text: "Нет доступных слотов для переноса", show_alert: true });
        return;
      }

      const paging = getPaging(groups, 0, CLIENT_GRID_PAGE_SIZE);
      await context.editMessageText(
        [
          "Перенос тренировки.",
          "",
          `Текущая тренировка: ${adminDateTimeFormatter.format(new Date(current.startAt))} (МСК).`,
          "Шаг 1: выберите новую дату.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildClientTrainingMoveDateKeyboard(bookingId, groups, paging.currentPage),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІС‹Р±РѕСЂ РґР°С‚С‹ РґР»СЏ РїРµСЂРµРЅРѕСЃР° РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось открыть перенос", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:move:datepage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseClientTrainingMoveDatePage(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({ text: "Некорректная страница", show_alert: true });
      return;
    }

    try {
      const trainings = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const current = trainings.items.find((entry) => entry.bookingId === parsed.bookingId);
      if (!current || !current.canReschedule) {
        await context.answerCallbackQuery({ text: "Перенос сейчас недоступен", show_alert: true });
        return;
      }

      const slots = filterAdminVisibleSlots(await dependencies.slotsApiService.getAvailableSlots(String(userId)));
      const groups = buildDateSlotsGroups(slots.filter((slot) => slot.startAt !== current.startAt));
      const paging = getPaging(groups, parsed.page, CLIENT_GRID_PAGE_SIZE);

      await context.editMessageText(
        [
          "Перенос тренировки.",
          "",
          `Текущая тренировка: ${adminDateTimeFormatter.format(new Date(current.startAt))} (МСК).`,
          "Шаг 1: выберите новую дату.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildClientTrainingMoveDateKeyboard(parsed.bookingId, groups, paging.currentPage),
        },
      );
      await context.answerCallbackQuery({ text: "Страница обновлена" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР»РёСЃС‚Р°С‚СЊ РґР°С‚С‹ РїРµСЂРµРЅРѕСЃР° РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId: parsed.bookingId,
        page: parsed.page,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось обновить страницу", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:move:date:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseClientTrainingMoveDate(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({ text: "Некорректная дата", show_alert: true });
      return;
    }

    try {
      const trainings = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const current = trainings.items.find((entry) => entry.bookingId === parsed.bookingId);
      if (!current || !current.canReschedule) {
        await context.answerCallbackQuery({ text: "Перенос сейчас недоступен", show_alert: true });
        return;
      }

      const slots = filterAdminVisibleSlots(await dependencies.slotsApiService.getAvailableSlots(String(userId)));
      const groups = buildDateSlotsGroups(slots.filter((slot) => slot.startAt !== current.startAt));
      const selectedGroup = groups.find((group) => group.dateKey === parsed.dateKey);
      if (!selectedGroup) {
        await context.answerCallbackQuery({ text: "Дата больше недоступна", show_alert: true });
        return;
      }

      const paging = getPaging(selectedGroup.slots, 0, CLIENT_GRID_PAGE_SIZE);
      await context.editMessageText(
        [
          "Перенос тренировки.",
          "",
          `Шаг 1: дата - ${selectedGroup.dateLabel}.`,
          "Шаг 2: выберите новое время.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildClientTrainingMoveTimeKeyboard(parsed.bookingId, selectedGroup, paging.currentPage),
        },
      );
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РІСЂРµРјСЏ РґР»СЏ РїРµСЂРµРЅРѕСЃР° РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId: parsed.bookingId,
        dateKey: parsed.dateKey,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось открыть время", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:move:timepage:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseClientTrainingMoveTimePage(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({ text: "Некорректная страница", show_alert: true });
      return;
    }

    try {
      const trainings = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const current = trainings.items.find((entry) => entry.bookingId === parsed.bookingId);
      if (!current || !current.canReschedule) {
        await context.answerCallbackQuery({ text: "Перенос сейчас недоступен", show_alert: true });
        return;
      }

      const slots = filterAdminVisibleSlots(await dependencies.slotsApiService.getAvailableSlots(String(userId)));
      const groups = buildDateSlotsGroups(slots.filter((slot) => slot.startAt !== current.startAt));
      const selectedGroup = groups.find((group) => group.dateKey === parsed.dateKey);
      if (!selectedGroup) {
        await context.answerCallbackQuery({ text: "Дата больше недоступна", show_alert: true });
        return;
      }
      const paging = getPaging(selectedGroup.slots, parsed.page, CLIENT_GRID_PAGE_SIZE);

      await context.editMessageText(
        [
          "Перенос тренировки.",
          "",
          `Шаг 1: дата - ${selectedGroup.dateLabel}.`,
          "Шаг 2: выберите новое время.",
          `Страница ${paging.currentPage + 1} из ${paging.totalPages}.`,
        ].join("\n"),
        {
          reply_markup: buildClientTrainingMoveTimeKeyboard(parsed.bookingId, selectedGroup, paging.currentPage),
        },
      );
      await context.answerCallbackQuery({ text: "Страница обновлена" });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕР»РёСЃС‚Р°С‚СЊ РІСЂРµРјСЏ РїРµСЂРµРЅРѕСЃР° РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId: parsed.bookingId,
        dateKey: parsed.dateKey,
        page: parsed.page,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({ text: "Не удалось обновить страницу", show_alert: true });
    }
  });

  bot.callbackQuery(/^cli:tr:move:pick:/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseClientTrainingMovePick(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({ text: "Некорректные данные переноса", show_alert: true });
      return;
    }

    try {
      const trainings = await dependencies.bookingsApiService.getClientTrainings(String(userId));
      const current = trainings.items.find((entry) => entry.bookingId === parsed.bookingId);
      if (!current || !current.canReschedule) {
        await context.answerCallbackQuery({ text: "Перенос сейчас недоступен", show_alert: true });
        return;
      }

      const slots = filterAdminVisibleSlots(await dependencies.slotsApiService.getAvailableSlots(String(userId)));
      const targetSlot = slots.find(
        (slot) =>
          slot.startAt !== current.startAt
          && new Date(slot.startAt).getTime() === parsed.startAtMs,
      );
      if (!targetSlot) {
        await context.answerCallbackQuery({ text: "Время больше недоступно", show_alert: true });
        return;
      }

      const result = await dependencies.bookingsApiService.rescheduleTrainingByClient({
        telegramId: String(userId),
        bookingId: parsed.bookingId,
        targetSlotId: targetSlot.id,
      });

      const newStartText = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));
      await context.answerCallbackQuery({ text: "Тренировка перенесена" });
      await sendOrReplaceClientNotice(
        context.api,
        String(userId),
        [
          "Вы перенесли тренировку.",
          `Новое время: ${newStartText} (МСК).`,
        ].join("\n"),
        buildClientQuickActionsKeyboard(),
      );

      for (const recipient of getAdminNotificationRecipients(dependencies)) {
        try {
          await sendOrReplaceAdminNotice(
            context.api,
            recipient,
            `Клиент ${result.booking.client.fullName} перенес тренировку на ${newStartText} (МСК).`,
          );
        } catch (notifyError) {
          const normalizedNotifyError = notifyError as Error;
          dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ СѓРІРµРґРѕРјРёС‚СЊ С‚СЂРµРЅРµСЂР° Рѕ РїРµСЂРµРЅРѕСЃРµ РєР»РёРµРЅС‚РѕРј", {
            bookingId: parsed.bookingId,
            recipient,
            message: normalizedNotifyError.message,
          });
        }
      }

      try {
        await sendClientCalendarInvite(context.api, String(userId), result.booking);
      } catch (inviteError) {
        const normalizedInviteError = inviteError as Error;
        dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ РїСЂРёРіР»Р°С€РµРЅРёРµ РїРѕСЃР»Рµ РїРµСЂРµРЅРѕСЃР°", {
          bookingId: parsed.bookingId,
          clientTelegramId: String(userId),
          message: normalizedInviteError.message,
        });
      }

      const view = await buildClientTrainingsView(userId, "Мои тренировки.", dependencies);
      await context.editMessageText(view.text, {
        reply_markup: view.keyboard,
      });
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РїРµСЂРµРЅРµСЃС‚Рё С‚СЂРµРЅРёСЂРѕРІРєСѓ РєР»РёРµРЅС‚РѕРј", {
        userId,
        bookingId: parsed.bookingId,
        message: normalizedError.message,
      });
      await context.answerCallbackQuery({
        text: getBookingErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery(/^cli:prop:(acc|dec):/, async (context) => {
    const userId = context.from?.id;
    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const parsed = parseClientProposalDecisionCallback(context.callbackQuery.data);
    if (!parsed) {
      await context.answerCallbackQuery({
        text: "Некорректные данные ответа",
        show_alert: true,
      });
      return;
    }

    try {
      const payload = {
        telegramId: String(userId),
        bookingId: parsed.bookingId,
      };

      const result =
        parsed.decision === "accept"
          ? await dependencies.bookingsApiService.acceptProposal(payload)
          : await dependencies.bookingsApiService.declineProposal(payload);

      const slotStartText = adminDateTimeFormatter.format(new Date(result.booking.slot.startAt));
      const clientName = result.booking.client.fullName;
      const trainerNotice =
        parsed.decision === "accept"
          ? `Клиент подтвердил предложенное время: ${clientName}, ${slotStartText} (МСК).`
          : `Клиент отклонил предложенное время: ${clientName}.`;

      const recipients = getAdminNotificationRecipients(dependencies);
      for (const recipient of recipients) {
        try {
          await sendOrReplaceAdminNotice(context.api, recipient, trainerNotice);
        } catch (notifyError) {
          const normalizedNotifyError = notifyError as Error;
          dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ С‚СЂРµРЅРµСЂСѓ СѓРІРµРґРѕРјР»РµРЅРёРµ РѕР± РѕС‚РІРµС‚Рµ РєР»РёРµРЅС‚Р° РЅР° РїСЂРµРґР»РѕР¶РµРЅРёРµ", {
            recipient,
            bookingId: parsed.bookingId,
            message: normalizedNotifyError.message,
          });
        }
      }

      if (parsed.decision === "accept") {
        await context.answerCallbackQuery({ text: "Время подтверждено" });
        try {
          await sendOrReplaceClientNotice(
            context.api,
            String(userId),
            [
              "Вы подтвердили предложенное время.",
              `Тренировка: ${slotStartText} (МСК).`,
              "До встречи на тренировке.",
            ].join("\n"),
            buildClientQuickActionsKeyboard(),
          );
          await sendClientCalendarInvite(context.api, String(userId), result.booking);
        } catch (notifyError) {
          const normalizedNotifyError = notifyError as Error;
          dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РїСЂР°РІРёС‚СЊ РєР»РёРµРЅС‚Сѓ РїСЂРёРіР»Р°С€РµРЅРёРµ РїРѕСЃР»Рµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ РїРµСЂРµРЅРѕСЃР°", {
            bookingId: parsed.bookingId,
            clientTelegramId: String(userId),
            message: normalizedNotifyError.message,
          });
        }
      } else {
        await context.answerCallbackQuery({ text: "Предложение отклонено" });
        await sendOrReplaceClientNotice(
          context.api,
          String(userId),
          [
            "Вы отклонили предложенное время.",
            "Тренер получит уведомление и при необходимости предложит другой вариант.",
          ].join("\n"),
          buildClientQuickActionsKeyboard(),
        );
      }
    } catch (error) {
      const normalizedError = error as Error;
      dependencies.logger.warn("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ РѕС‚РІРµС‚ РєР»РёРµРЅС‚Р° РЅР° РїСЂРµРґР»РѕР¶РµРЅРЅРѕРµ РІСЂРµРјСЏ", {
        userId,
        bookingId: parsed.bookingId,
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: getClientProposalActionErrorMessage(normalizedError),
        show_alert: true,
      });
    }
  });

  bot.callbackQuery("nav:back", async (context) => {
    const userId = context.from?.id;

    if (!userId) {
      await context.answerCallbackQuery();
      return;
    }

    const role = dependencies.resolveRole(userId);

    try {
      const targetScreen = dependencies.navigationService.goBack(userId, role);
      const staticView = buildScreenView(targetScreen, role);

      let text = staticView.text;
      let keyboard = staticView.keyboard;

      if (targetScreen === "admin-main" && role === "admin") {
        const adminMainView = buildAdminMainView();
        text = adminMainView.text;
        keyboard = adminMainView.keyboard;
      }

      if (targetScreen === "client-booking") {
        const dynamicView = await buildClientBookingView(userId, staticView.text, dependencies);
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (targetScreen === "client-trainings") {
        const dynamicView = await buildClientTrainingsView(userId, staticView.text, dependencies);
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (targetScreen === "client-no-slot") {
        const dynamicView = buildClientNoSlotView();
        text = dynamicView.text;
        keyboard = dynamicView.keyboard;
      }

      if (targetScreen === "admin-requests") {
        const adminView = await buildAdminRequestsView(dependencies);
        text = adminView.text;
        keyboard = adminView.keyboard;
      }

      if (targetScreen === "admin-slots") {
        const adminSlotsView = await buildAdminSlotsView(dependencies);
        text = adminSlotsView.text;
        keyboard = adminSlotsView.keyboard;
      }

      if (targetScreen === "admin-settings") {
        const adminSettingsView = await buildAdminSettingsView(dependencies);
        text = adminSettingsView.text;
        keyboard = adminSettingsView.keyboard;
      }

      dependencies.logger.info("РћС‚РєСЂС‹С‚ СЌРєСЂР°РЅ", {
        userId,
        role,
        screenId: targetScreen,
        source: "back",
      });

      await context.editMessageText(text, {
        reply_markup: keyboard,
      });
      await context.answerCallbackQuery();
    } catch (error) {
      const normalizedError = error as Error;

      dependencies.logger.error("РћС€РёР±РєР° РїРµСЂРµС…РѕРґР° РїРѕ РєРЅРѕРїРєРµ", {
        userId,
        role,
        action: "back",
        message: normalizedError.message,
      });

      await context.answerCallbackQuery({
        text: "Не удалось вернуться назад.",
        show_alert: true,
      });
    }
  });
}







