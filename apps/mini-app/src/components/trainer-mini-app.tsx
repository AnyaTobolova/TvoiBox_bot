"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  AvailableSlot,
  ClientProfile,
  MiniAppApi,
  MiniAppMeResponse,
  NoSlotRequestDto,
  NoSlotRequestStatusType,
  PendingBookingDto,
  TrainerSettingsDto,
  TrainerTrainingDto,
} from "../lib/mini-app-api";
import { isLocalPreviewEnvironment } from "../lib/mini-app-preview";

type TrainerScreenId = "home" | "bookings" | "trainings" | "slots" | "clients" | "settings" | "no-slot" | "profile" | "support";

interface TrainerMiniAppProps {
  api: MiniAppApi;
  session: MiniAppMeResponse;
}

interface SettingsFormState {
  bookingHorizonDays: string;
  sameDayBookingCutoff: string;
  workingDays: string[];
  workdayStartHour: string;
  workdayEndHour: string;
}

interface SlotRangeState {
  from: string;
  to: string;
}

interface BulkSlotFormState {
  startAt: string;
  endAt: string;
  reason: string;
}

interface MessageState {
  tone: "success" | "error" | "info";
  text: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Понедельник",
  tuesday: "Вторник",
  wednesday: "Среда",
  thursday: "Четверг",
  friday: "Пятница",
  saturday: "Суббота",
  sunday: "Воскресенье",
};

const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const MOSCOW_TIME_ZONE = "Europe/Moscow";

function formatMoscowInputParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01",
    hour: parts.find((part) => part.type === "hour")?.value ?? "00",
    minute: parts.find((part) => part.type === "minute")?.value ?? "00",
  };
}

function formatDateTime(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateIso));
}

function formatTime(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateIso));
}

function formatShortDate(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(dateIso));
}

function formatDayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(dateIso));
}

function toLocalDateTimeInputValue(date: Date): string {
  const parts = formatMoscowInputParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function toIsoDateTimeOrThrow(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Укажите корректные дату и время.");
  }

  return parsed.toISOString();
}

function toMoscowIsoDateTimeOrThrow(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Укажите корректные дату и время.");
  }

  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute), 0, 0));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Укажите корректные дату и время.");
  }

  return parsed.toISOString();
}

function getNextFullHour(): Date {
  const now = new Date();
  return new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
}

function buildDefaultRange(): SlotRangeState {
  const start = getNextFullHour();
  const end = new Date(start.getTime() + 7 * DAY_MS);
  return {
    from: toLocalDateTimeInputValue(start),
    to: toLocalDateTimeInputValue(end),
  };
}

function getBookingTone(status: PendingBookingDto["status"] | TrainerTrainingDto["bookingStatus"]): "pending" | "success" | "danger" | "muted" {
  switch (status) {
    case "PENDING":
    case "RESCHEDULED":
      return "pending";
    case "CONFIRMED":
      return "success";
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
      return "danger";
    default:
      return "muted";
  }
}

function getBookingStatusLabel(status: PendingBookingDto["status"] | TrainerTrainingDto["bookingStatus"]): string {
  switch (status) {
    case "PENDING":
      return "Ожидает решения";
    case "CONFIRMED":
      return "Подтверждено";
    case "RESCHEDULED":
      return "Есть перенос";
    case "REJECTED":
      return "Отклонено";
    case "CANCELLED":
      return "Отменено";
    case "EXPIRED":
      return "Истекло";
    default:
      return status;
  }
}

function getNoSlotStatusLabel(status: NoSlotRequestStatusType): string {
  switch (status) {
    case "NEW":
      return "Новый";
    case "REVIEWED":
      return "В работе";
    case "ARCHIVED":
      return "В архиве";
    default:
      return status;
  }
}

function groupSlotsByDay(slots: AvailableSlot[]) {
  const groups = new Map<string, AvailableSlot[]>();

  for (const slot of slots) {
    const dayKey = slot.startAt.slice(0, 10);
    const current = groups.get(dayKey) ?? [];
    current.push(slot);
    groups.set(dayKey, current);
  }

  return [...groups.entries()].map(([dayKey, items]) => ({
    dayKey,
    title: formatDayLabel(items[0].startAt),
    items: items.sort((left, right) => left.startAt.localeCompare(right.startAt)),
  }));
}

function getClientContactHref(client: { username: string | null; telegramId: string }): string {
  if (client.username) {
    return `https://t.me/${client.username.replace(/^@/, "")}`;
  }

  return `tg://user?id=${client.telegramId}`;
}

function sortPendingBookings(items: PendingBookingDto[]): PendingBookingDto[] {
  return [...items].sort((left, right) => left.slot.startAt.localeCompare(right.slot.startAt));
}

function sortTrainerTrainings(items: TrainerTrainingDto[]): TrainerTrainingDto[] {
  return [...items].sort((left, right) => left.startAt.localeCompare(right.startAt));
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 3v4M16 3v4M4 10h16" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M21 5 3.8 11.6c-.8.3-.8 1.4.1 1.6l4.4 1.3 1.7 5.1c.3.8 1.4.9 1.8.2l2.4-3.5 4.4 3.3c.7.5 1.7.1 1.8-.8L22 6.4c.1-1-.9-1.8-1.8-1.4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m8.5 14.4 9.1-7.4M10.1 19.6l1.8-4.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function normalizeUiErrorMessage(error: Error): string {
  const raw = error.message?.trim() || "Не удалось выполнить действие.";

  try {
    const parsed = JSON.parse(raw) as { message?: string; statusCode?: number };
    if (parsed.message?.includes("Google OAuth token request failed")) {
      return "Календарь сейчас недоступен. Проверьте подключение Google Calendar.";
    }
    if (parsed.message?.includes("Booking cannot be force-closed in current status")) {
      return "Эту тренировку нельзя удалить этим действием. Она будет скрываться через удаление из списка.";
    }
    if (parsed.message?.includes("trainerComment is required")) {
      return "Для этого действия нужен комментарий тренера.";
    }
    return parsed.message || raw;
  } catch {
    if (raw.includes("Google OAuth token request failed")) {
      return "Календарь сейчас недоступен. Проверьте подключение Google Calendar.";
    }
    if (raw.includes("Booking is already archived for trainer")) {
      return "Эта тренировка уже удалена из списка тренера.";
    }
    if (raw.includes("Google Calendar HTTP 410")) {
      return "Событие уже удалено из Google Calendar. Локальная запись будет обновлена без ошибки.";
    }
    return raw;
  }
}

export function TrainerMiniApp({ api, session }: TrainerMiniAppProps) {
  const defaultRange = useMemo(() => buildDefaultRange(), []);
  const [screen, setScreen] = useState<TrainerScreenId>("home");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [bookings, setBookings] = useState<PendingBookingDto[]>([]);
  const [trainings, setTrainings] = useState<TrainerTrainingDto[]>([]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotRange, setSlotRange] = useState<SlotRangeState>(defaultRange);
  const [bulkSlotForm, setBulkSlotForm] = useState<BulkSlotFormState>({
    startAt: defaultRange.from,
    endAt: defaultRange.to,
    reason: "",
  });
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>({
    bookingHorizonDays: "14",
    sameDayBookingCutoff: "0",
    workingDays: [...WEEKDAY_ORDER],
    workdayStartHour: "8",
    workdayEndHour: "22",
  });
  const [settingsMeta, setSettingsMeta] = useState<TrainerSettingsDto>({
    bookingHorizonDays: 14,
    sameDayBookingCutoff: 0,
    workingDays: ["monday", "wednesday", "friday"],
    workdayStartHour: 8,
    workdayEndHour: 22,
    updatedAt: new Date().toISOString(),
  });
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientProfile[]>([]);
  const [blacklist, setBlacklist] = useState<ClientProfile[]>([]);
  const [noSlotRequests, setNoSlotRequests] = useState<NoSlotRequestDto[]>([]);
  const [bookingCommentDrafts, setBookingCommentDrafts] = useState<Record<string, string>>({});
  const [bookingTimeDrafts, setBookingTimeDrafts] = useState<Record<string, string>>({});
  const [trainingCommentDrafts, setTrainingCommentDrafts] = useState<Record<string, string>>({});
  const [trainingTimeDrafts, setTrainingTimeDrafts] = useState<Record<string, string>>({});
  const [blacklistReasonDrafts, setBlacklistReasonDrafts] = useState<Record<string, string>>({});
  const [noSlotCommentDrafts, setNoSlotCommentDrafts] = useState<Record<string, string>>({});
  const [bookingProposalOpen, setBookingProposalOpen] = useState<Record<string, boolean>>({});
  const [trainingProposalOpen, setTrainingProposalOpen] = useState<Record<string, boolean>>({});

  const slotGroups = groupSlotsByDay(slots);
  const trainerName = session.profile?.fullName || [session.session.firstName, session.session.lastName].filter(Boolean).join(" ") || "Тренер";

  const visibleBookings = sortPendingBookings(bookings.filter((item) => item.status === "PENDING" || item.status === "RESCHEDULED"));
  const activeNoSlotRequests = noSlotRequests.filter((item) => item.status !== "ARCHIVED");
  const sortedTrainings = sortTrainerTrainings(trainings);
  const upcomingTrainings = sortedTrainings
    .filter((item) => new Date(item.startAt).getTime() >= Date.now())
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const nearestTrainingTime = upcomingTrainings[0] ? formatTime(upcomingTrainings[0].startAt) : "—";

  const todayMoscowKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const activeUpcomingTrainings = upcomingTrainings.filter((item) => item.bookingStatus !== "CANCELLED");
  const todayTrainingCount = activeUpcomingTrainings.filter((item) => {
    const parts = formatMoscowInputParts(new Date(item.startAt));
    return `${parts.year}-${parts.month}-${parts.day}` === todayMoscowKey;
  }).length;
  const nearestTrainingLabel = activeUpcomingTrainings[0]
    ? `${formatShortDate(activeUpcomingTrainings[0].startAt)}; ${formatTime(activeUpcomingTrainings[0].startAt)}`
    : "Пока нет";

  useEffect(() => {
    void loadHomeData();
  }, []);

  useEffect(() => {
    switch (screen) {
      case "home":
        void loadHomeData();
        break;
      case "bookings":
        void loadBookings();
        break;
      case "trainings":
        void loadTrainings();
        break;
      case "clients":
        void loadBlacklist();
        break;
      case "settings":
        void loadSettings();
        break;
      case "no-slot":
        void loadNoSlotRequests();
        break;
      default:
        break;
    }
  }, [screen]);

  useEffect(() => {
    if (screen === "slots") {
      void loadSlots();
    }
  }, [screen, slotRange.from, slotRange.to]);

  function renderCompactHeader(
    title: string,
    text: string,
    onBack: () => void,
    onRefresh?: () => void,
    extraAction?: ReactNode,
  ) {
    return (
      <div className="panel-header panel-header-compact panel-header-slim">
        <div>
          <button className="back-link back-link-inline" disabled={isBusy} onClick={onBack}>
            ← Назад
          </button>
          <h2 className="panel-title">{title}</h2>
          <p className="panel-text">{text}</p>
        </div>
        <div className="panel-header-actions">
          {onRefresh ? (
            <button
              className="secondary-button secondary-button-compact icon-button-compact"
              aria-label={`Обновить раздел ${title}`}
              title="Обновить"
              disabled={isBusy}
              onClick={onRefresh}
            >
              <RefreshIcon />
            </button>
          ) : null}
          {extraAction}
        </div>
      </div>
    );
  }

  async function runTask(task: () => Promise<void>, successMessage?: string) {
    setIsBusy(true);
    setMessage(null);

    try {
      await task();
      if (successMessage) {
        setMessage({ tone: "success", text: successMessage });
      }
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizeUiErrorMessage(normalizedError) });
    } finally {
      setIsBusy(false);
    }
  }

  async function loadHomeData() {
    await runTask(async () => {
      const [bookingsResponse, trainingsResponse, noSlotResponse, blacklistResponse] = await Promise.all([
        api.getTrainerBookings(),
        api.getTrainerTrainings({
          from: toMoscowIsoDateTimeOrThrow(slotRange.from),
          to: toMoscowIsoDateTimeOrThrow(slotRange.to),
        }),
        api.getTrainerNoSlotRequests(),
        api.getTrainerBlacklist(),
      ]);

      setBookings(sortPendingBookings(bookingsResponse.items));
      setTrainings(sortTrainerTrainings(trainingsResponse.items));
      setNoSlotRequests(noSlotResponse.items);
      setBlacklist(blacklistResponse.items);
    });
  }

  async function loadBookings() {
    await runTask(async () => {
      const [bookingsResponse, noSlotResponse] = await Promise.all([
        api.getTrainerBookings(),
        api.getTrainerNoSlotRequests(),
      ]);
      setBookings(sortPendingBookings(bookingsResponse.items));
      setNoSlotRequests(noSlotResponse.items);
    });
  }

  async function loadTrainings() {
    await runTask(async () => {
      const response = await api.getTrainerTrainings({
        from: toMoscowIsoDateTimeOrThrow(slotRange.from),
        to: toMoscowIsoDateTimeOrThrow(slotRange.to),
      });
      setTrainings(sortTrainerTrainings(response.items));
    });
  }

  async function loadSlots() {
    await runTask(async () => {
      const slotsResponse = await api.getTrainerSlots({
        from: toMoscowIsoDateTimeOrThrow(slotRange.from),
        to: toMoscowIsoDateTimeOrThrow(slotRange.to),
      });

      setSlots(slotsResponse);
    });
  }

  async function loadSettings() {
    await runTask(async () => {
      const response = await api.getTrainerSettings();
      setSettingsMeta(response.settings);
      setSettingsForm({
        bookingHorizonDays: String(response.settings.bookingHorizonDays),
        sameDayBookingCutoff: String(response.settings.sameDayBookingCutoff),
        workingDays: [...response.settings.workingDays],
        workdayStartHour: String(response.settings.workdayStartHour),
        workdayEndHour: String(response.settings.workdayEndHour),
      });
    });
  }

  async function loadBlacklist() {
    await runTask(async () => {
      const response = await api.getTrainerBlacklist();
      setBlacklist(response.items);
    });
  }

  async function loadNoSlotRequests() {
    await runTask(async () => {
      const response = await api.getTrainerNoSlotRequests();
      setNoSlotRequests(response.items);
    });
  }

  async function handleConfirmBooking(bookingId: string) {
    await runTask(async () => {
      await api.confirmTrainerBooking({ bookingId });
      await loadBookings();
      await loadTrainings();
    }, "Заявка подтверждена.");
  }

  async function handleRejectBooking(bookingId: string) {
    const trainerComment = bookingCommentDrafts[bookingId]?.trim() || "";
    if (!trainerComment) {
      setMessage({ tone: "error", text: "Для отклонения заявки нужен комментарий тренера." });
      return;
    }

    await runTask(async () => {
      await api.rejectTrainerBooking({ bookingId, trainerComment });
      await loadBookings();
    }, "Заявка отклонена.");
  }

  async function handleProposeBookingTime(bookingId: string) {
    const trainerComment = bookingCommentDrafts[bookingId]?.trim() || "";
    const proposedTime = bookingTimeDrafts[bookingId]?.trim() || "";
    if (!trainerComment) {
      setMessage({ tone: "error", text: "Для предложения другого времени нужен комментарий тренера." });
      return;
    }
    if (!proposedTime) {
      setMessage({ tone: "error", text: "Укажите новое время для предложения." });
      return;
    }

    await runTask(async () => {
      await api.proposeTrainerBookingTime({
        bookingId,
        trainerComment,
        proposedStartAt: toMoscowIsoDateTimeOrThrow(proposedTime),
      });
      await loadBookings();
    }, "Предложение другого времени отправлено клиенту.");
  }

  async function handleArchiveBooking(bookingId: string) {
    await runTask(async () => {
      await api.archiveTrainerBooking({ bookingId });
      await loadBookings();
    }, "Запись скрыта из активного списка.");
  }

  async function handleCancelTraining(bookingId: string) {
    const trainerComment = trainingCommentDrafts[bookingId]?.trim() || "Тренировка отменена тренером.";

    await runTask(async () => {
      await api.cancelTrainerTraining({ bookingId, trainerComment });
      await loadTrainings();
    }, "Тренировка отменена.");
  }

  async function handleRescheduleTraining(bookingId: string) {
    const trainerComment = trainingCommentDrafts[bookingId]?.trim() || "";
    const newStartAt = trainingTimeDrafts[bookingId]?.trim() || "";
    if (!trainerComment) {
      setMessage({ tone: "error", text: "Для переноса тренировки нужен комментарий тренера." });
      return;
    }
    if (!newStartAt) {
      setMessage({ tone: "error", text: "Укажите новое время тренировки." });
      return;
    }

    await runTask(async () => {
      await api.rescheduleTrainerTraining({
        bookingId,
        trainerComment,
        newStartAt: toMoscowIsoDateTimeOrThrow(newStartAt),
      });
      await loadTrainings();
      await loadBookings();
    }, "Предложение по переносу отправлено.");
  }

  async function handleForceCloseTraining(bookingId: string) {
    await runTask(async () => {
      await api.archiveTrainerBooking({ bookingId });
      await loadTrainings();
    }, "Тренировка скрыта из списка.");
  }

  async function handleResyncTraining(bookingId: string) {
    await runTask(async () => {
      await api.resyncTrainerCalendar({ bookingId });
      await loadTrainings();
    }, "Календарь пересинхронизирован.");
  }

  async function handleDownloadBookingCalendarFile(bookingId: string, startAt: string) {
    await runTask(async () => {
      const blob = await api.downloadTrainerBookingCalendarFile(bookingId);
      const url = window.URL.createObjectURL(blob);
      const date = new Date(startAt);
      const fileName = `tvoy-box-booking-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}.ics`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
    }, "Файл календаря скачан. Внутри уже добавлены напоминания за 1 день и за 1 час.");
  }

  async function handleRejectBookingQuick(bookingId: string) {
    await runTask(async () => {
      await api.rejectTrainerBooking({
        bookingId,
        trainerComment: bookingCommentDrafts[bookingId]?.trim() || "",
      });
      await loadBookings();
    }, "Заявка отклонена.");
  }

  async function handleProposeBookingTimeFromCard(bookingId: string) {
    const trainerComment = bookingCommentDrafts[bookingId]?.trim() || "";
    const proposedTime = bookingTimeDrafts[bookingId]?.trim() || "";
    if (!trainerComment) {
      setMessage({ tone: "error", text: "Добавьте комментарий для клиента." });
      return;
    }
    if (!proposedTime) {
      setMessage({ tone: "error", text: "Укажите новое время для предложения." });
      return;
    }

    await runTask(async () => {
      await api.proposeTrainerBookingTime({
        bookingId,
        trainerComment,
        proposedStartAt: toMoscowIsoDateTimeOrThrow(proposedTime),
      });
      setBookingProposalOpen((current) => ({ ...current, [bookingId]: false }));
      await loadBookings();
    }, "Новое время отправлено клиенту.");
  }

  async function handleRescheduleTrainingFromCard(bookingId: string) {
    const trainerComment = trainingCommentDrafts[bookingId]?.trim() || "";
    const newStartAt = trainingTimeDrafts[bookingId]?.trim() || "";
    if (!newStartAt) {
      setMessage({ tone: "error", text: "Укажите новое время тренировки." });
      return;
    }

    await runTask(async () => {
      await api.rescheduleTrainerTraining({
        bookingId,
        trainerComment,
        newStartAt: toMoscowIsoDateTimeOrThrow(newStartAt),
      });
      setTrainingProposalOpen((current) => ({ ...current, [bookingId]: false }));
      await loadTrainings();
      await loadBookings();
    }, "Перенос отправлен клиенту.");
  }

  async function handleResyncAllTrainings() {
    if (isLocalPreviewEnvironment()) {
      setMessage({
        tone: "info",
        text: "В локальном preview Google Calendar не подключается. Эту синхронизацию проверим отдельно на живом backend и сервере.",
      });
      return;
    }

    const items = trainings.filter((item) => item.canResyncCalendar);
    if (items.length === 0) {
      setMessage({ tone: "info", text: "В этом диапазоне нет тренировок для пересинхронизации." });
      return;
    }

    await runTask(async () => {
      await Promise.all(items.map((item) => api.resyncTrainerCalendar({ bookingId: item.bookingId })));
      await loadTrainings();
    }, "Календарь пересинхронизирован по всем актуальным тренировкам.");
  }

  async function handleToggleSlot(slot: AvailableSlot) {
    if (slot.status === "BOOKED" || slot.status === "HELD") {
      setMessage({ tone: "info", text: "Этот слот сейчас нельзя менять прямо из mini app." });
      return;
    }

    await runTask(async () => {
      if (slot.status === "OPEN") {
        await api.closeTrainerSlots({
          slotId: slot.id.startsWith("virtual|") ? undefined : slot.id,
          startAt: slot.id.startsWith("virtual|") ? slot.startAt : undefined,
          endAt: slot.id.startsWith("virtual|") ? slot.endAt : undefined,
        });
      } else {
        await api.openTrainerSlots({
          startAt: slot.startAt,
          endAt: slot.endAt,
        });
      }

      await loadSlots();
    }, slot.status === "OPEN" ? "Слот закрыт." : "Слот открыт.");
  }

  async function handleBulkCloseSlots() {
    await runTask(async () => {
      await api.closeTrainerSlots({
        startAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.startAt),
        endAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.endAt),
        reason: bulkSlotForm.reason || null,
      });
      await loadSlots();
    }, "Диапазон слотов закрыт.");
  }

  async function handleBulkOpenSlots() {
    await runTask(async () => {
      await api.openTrainerSlots({
        startAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.startAt),
        endAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.endAt),
      });
      await loadSlots();
    }, "Диапазон слотов открыт.");
  }

  async function handleBulkReopenSlots() {
    await runTask(async () => {
      await api.reopenTrainerSlots({
        startAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.startAt),
        endAt: toMoscowIsoDateTimeOrThrow(bulkSlotForm.endAt),
      });
      await loadSlots();
    }, "Диапазон слотов переоткрыт.");
  }

  async function handleSaveSettings() {
    const bookingHorizonDays = Number(settingsForm.bookingHorizonDays);
    const sameDayBookingCutoff = Number(settingsForm.sameDayBookingCutoff);
    const workdayStartHour = Number(settingsForm.workdayStartHour);
    const workdayEndHour = Number(settingsForm.workdayEndHour);
    if (
      !Number.isInteger(bookingHorizonDays)
      || !Number.isInteger(sameDayBookingCutoff)
      || !Number.isInteger(workdayStartHour)
      || !Number.isInteger(workdayEndHour)
    ) {
      setMessage({ tone: "error", text: "Настройки должны быть целыми числами." });
      return;
    }
    if (settingsForm.workingDays.length === 0) {
      setMessage({ tone: "error", text: "Выберите хотя бы один рабочий день." });
      return;
    }
    if (workdayEndHour <= workdayStartHour) {
      setMessage({ tone: "error", text: "Конец рабочего времени должен быть позже начала." });
      return;
    }

    await runTask(async () => {
      const response = await api.updateTrainerSettings({
        bookingHorizonDays,
        sameDayBookingCutoff,
        workingDays: settingsForm.workingDays,
        workdayStartHour,
        workdayEndHour,
      });
      setSettingsMeta(response.settings);
      setSettingsForm({
        bookingHorizonDays: String(response.settings.bookingHorizonDays),
        sameDayBookingCutoff: String(response.settings.sameDayBookingCutoff),
        workingDays: [...response.settings.workingDays],
        workdayStartHour: String(response.settings.workdayStartHour),
        workdayEndHour: String(response.settings.workdayEndHour),
      });
    }, "Настройки записи сохранены.");
  }

  function toggleWorkingDay(day: string) {
    setSettingsForm((current) => ({
      ...current,
      workingDays: current.workingDays.includes(day)
        ? current.workingDays.filter((item) => item !== day)
        : [...current.workingDays, day],
    }));
  }

  async function handleSearchClients() {
    const query = clientSearchQuery.trim();
    if (query.length < 2) {
      setMessage({ tone: "error", text: "Для поиска введите минимум 2 символа." });
      return;
    }

    await runTask(async () => {
      const response = await api.searchTrainerClients(query, 12);
      setClientResults(response.items);
    });
  }

  async function handleAddToBlacklist(clientId: string) {
    const reason = blacklistReasonDrafts[clientId]?.trim() || "";
    if (!reason) {
      setMessage({ tone: "error", text: "Укажите причину добавления в чёрный список." });
      return;
    }

    await runTask(async () => {
      await api.addTrainerBlacklist({ clientId, reason });
      await loadBlacklist();
      await handleSearchClients();
    }, "Клиент добавлен в чёрный список.");
  }

  async function handleRemoveFromBlacklist(clientId: string) {
    await runTask(async () => {
      await api.removeTrainerBlacklist({ clientId });
      await loadBlacklist();
      await handleSearchClients();
    }, "Клиент убран из чёрного списка.");
  }

  async function handleUpdateNoSlotRequest(requestId: string, status: NoSlotRequestStatusType) {
    await runTask(async () => {
      await api.updateTrainerNoSlotRequest({
        requestId,
        status,
        trainerComment: noSlotCommentDrafts[requestId]?.trim() || null,
      });
      await loadNoSlotRequests();
    }, status === "ARCHIVED" ? "Запрос отправлен в архив." : "Статус запроса обновлён.");
  }

  async function handleExport() {
    await runTask(async () => {
      const blob = await api.exportTrainerData({
        from: toMoscowIsoDateTimeOrThrow(slotRange.from),
        to: toMoscowIsoDateTimeOrThrow(slotRange.to),
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "tvoy-box-mini-app-export.csv";
      anchor.click();
      window.URL.revokeObjectURL(url);
    }, "CSV выгрузка подготовлена.");
  }

  return (
    <main className="mini-app-page">
      <div className="mini-app-shell">
        <header className={`topbar${screen !== "home" ? " topbar-subpage" : ""}`}>
          <div className="brand">
            <Image className="brand-logo" src="/assets/logo-mark.png" alt="Знак Твой Бокс" width={52} height={52} />
            <div className="brand-copy">
              <span className="brand-title">
                <span className="brand-title-main">ТВОЙ</span>
                <span className="brand-title-accent">БОКС</span>
              </span>
              <span className="brand-tagline">Твой путь к силе и уверенности</span>
            </div>
          </div>

          <div className="topbar-actions">
            {screen !== "home" ? (
              <button className="ghost-button" onClick={() => setScreen("home")}>
                Главная
              </button>
            ) : null}
            <button
              className="icon-button"
              aria-label="Профиль"
              title="Профиль"
              data-tooltip="Профиль"
              onClick={() => setScreen("profile")}
            >
              П
            </button>
            <button
              className="icon-button"
              aria-label="Помощь"
              title="Помощь"
              data-tooltip="Помощь"
              onClick={() => setScreen("support")}
            >
              ?
            </button>
          </div>
        </header>

        {message ? (
          <div className={`alert ${message.tone === "success" ? "alert-success" : message.tone === "error" ? "alert-error" : "alert-info"}`}>
            <div>
              <strong>{message.tone === "success" ? "Готово" : message.tone === "error" ? "Есть проблема" : "Подсказка"}</strong>
              <p>{message.text}</p>
            </div>
            <button className="link-button" onClick={() => setMessage(null)}>
              Скрыть
            </button>
          </div>
        ) : null}

        {screen === "home" ? (
          <>
            <section className="hero-card">
              <div className="trainer-hero-grid">
                <div className="trainer-hero-copy">
                  <h1 className="hero-title trainer-thought-title">
                    <span className="hero-title-line">Сила начинается не с удара.</span>
                    <span className="hero-title-line">Сила начинается с уверенности в себе.</span>
                  </h1>
                  <p className="hero-lead trainer-thought-lead">
                    Каждая тренировка начинается с первого шага. Помоги человеку почувствовать себя сильнее, чем вчера.
                  </p>
                </div>

                <aside className="trainer-thought-panel">
                  <Image className="trainer-watermark" src="/assets/logo-mark.png" alt="" width={320} height={320} aria-hidden="true" />
                  <div className="trainer-thought-cards">
                    <article className="summary-card trainer-thought-card">
                      <span>Сегодня тренировок</span>
                      <strong>{todayTrainingCount}</strong>
                    </article>
                    <article className="summary-card trainer-thought-card">
                      <span>Новых заявок</span>
                      <strong>{visibleBookings.length + activeNoSlotRequests.length}</strong>
                    </article>
                    <article className="summary-card trainer-thought-card">
                      <span>Ближайшее занятие</span>
                      <strong>{nearestTrainingLabel}</strong>
                    </article>
                  </div>
                </aside>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header panel-header-compact panel-header-slim">
                <div>
                  <h2 className="panel-title">Главное меню</h2>
                  <p className="panel-text">Три рабочих раздела: заявки, тренировки и настройки.</p>
                </div>
                <div className="panel-header-actions">
                  <button
                    className="secondary-button secondary-button-compact icon-button-compact"
                    aria-label="Обновить главную"
                    title="Обновить"
                    disabled={isBusy}
                    onClick={() => void loadHomeData()}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>

              <div className="trainer-home-grid">
                <article className="action-card action-card-home">
                  <span className="badge">{visibleBookings.length + activeNoSlotRequests.length} на согласовании</span>
                  <strong>Заявки</strong>
                  <p>Новые записи, переносы и запросы без слота собраны в одном месте, чтобы они не терялись.</p>
                  <button className="primary-button" onClick={() => setScreen("bookings")}>
                    Открыть заявки
                  </button>
                </article>

                <article className="action-card action-card-home">
                  <span className="badge">{trainings.length} в диапазоне</span>
                  <strong>Тренировки</strong>
                  <p>Подтвержденные, отмененные и перенесенные тренировки с быстрым переходом к клиенту и общим ресинком календаря.</p>
                  <button className="primary-button" onClick={() => setScreen("trainings")}>
                    Открыть тренировки
                  </button>
                </article>

                <article className="action-card action-card-home">
                  <span className="badge">Параметры и слоты</span>
                  <strong>Настройки</strong>
                  <p>Параметры записи, рабочие дни и время, слоты, поиск клиентов и черный список собраны в техническом блоке.</p>
                  <button className="primary-button" onClick={() => setScreen("settings")}>
                    Открыть настройки
                  </button>
                </article>
              </div>
            </section>
          </>
        ) : false ? (
          <>
            <section className="hero-card">
              <div className="hero-grid">
                <div>
                  <p className="hero-welcome">Здравствуйте, {trainerName}.</p>
                  <h1 className="hero-title">Заявки, слоты и тренировки в одном месте.</h1>
                  <p className="hero-lead">Открывай расписание, подтверждай заявки и управляй клиентским потоком без длинной переписки в боте.</p>
                </div>

                <aside className="hero-aside">
                  <div className="trainer-frame">
                    <Image className="trainer-photo" src="/assets/trainer.png" alt="Тренер Твой Бокс" width={800} height={1000} priority />
                  </div>
                </aside>
              </div>
            </section>

            <section className="content-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Главные разделы</h2>
                    <p className="panel-text">Переходи в нужный контур без возврата к бот-командам.</p>
                  </div>
                </div>

                <div className="card-grid card-grid-split">
                  <article className="action-card">
                    <span className="badge">{bookings.length} активных</span>
                    <strong>Заявки</strong>
                    <p>Новые и актуальные заявки клиентов с подтверждением, отклонением и предложением другого времени.</p>
                    <button className="primary-button" onClick={() => setScreen("bookings")}>
                      Открыть заявки
                    </button>
                  </article>

                  <article className="action-card">
                    <span className="badge">{trainings.length} в диапазоне</span>
                    <strong>Тренировки</strong>
                    <p>Будущие подтверждённые тренировки, переносы, отмены и ручной ресинк календаря.</p>
                    <button className="primary-button" onClick={() => setScreen("trainings")}>
                      Открыть тренировки
                    </button>
                  </article>

                  <article className="action-card">
                    <span className="badge">{slotGroups.length} дней</span>
                    <strong>Слоты</strong>
                    <p>Открывай и закрывай часы, управляй диапазонами и проверяй периоды ручного закрытия.</p>
                    <button className="primary-button" onClick={() => setScreen("slots")}>
                      Открыть слоты
                    </button>
                  </article>

                  <article className="action-card">
                    <span className="badge">{noSlotRequests.length} запросов</span>
                    <strong>Без слота</strong>
                    <p>Все пожелания клиентов по удобным дням и времени в одном списке.</p>
                    <button className="primary-button" onClick={() => setScreen("no-slot")}>
                      Открыть запросы
                    </button>
                  </article>

                  <article className="action-card">
                    <span className="badge">{blacklist.length} в чёрном списке</span>
                    <strong>Клиенты</strong>
                    <p>Поиск по имени, телефону и username, работа с карточками и чёрным списком.</p>
                    <button className="primary-button" onClick={() => setScreen("clients")}>
                      Открыть клиентов
                    </button>
                  </article>

                  <article className="action-card">
                    <span className="badge">Настройки и CSV</span>
                    <strong>Настройки</strong>
                    <p>Горизонт записи, cutoff на запись день-в-день и быстрая CSV-выгрузка.</p>
                    <div className="record-actions">
                      <button className="primary-button" onClick={() => setScreen("settings")}>
                        Открыть настройки
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleExport()}>
                        Выгрузить CSV
                      </button>
                    </div>
                  </article>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2 className="panel-title">Быстрый обзор</h2>
                    <p className="panel-text">Ключевые цифры по текущему диапазону.</p>
                  </div>
                  <button className="secondary-button" disabled={isBusy} onClick={() => void loadHomeData()}>
                    Обновить
                  </button>
                </div>

                <div className="summary-grid">
                  <article className="summary-card">
                    <strong>{bookings.filter((item) => item.status === "PENDING").length}</strong>
                    <span>Ждут решения</span>
                  </article>
                  <article className="summary-card">
                    <strong>{trainings.filter((item) => item.bookingStatus === "RESCHEDULED").length}</strong>
                    <span>С переносом</span>
                  </article>
                  <article className="summary-card">
                    <strong>{noSlotRequests.filter((item) => item.status === "NEW").length}</strong>
                    <span>Новых без слота</span>
                  </article>
                  <article className="summary-card">
                    <strong>{blacklist.length}</strong>
                    <span>Чёрный список</span>
                  </article>
                </div>

                <div className="form-grid" style={{ marginTop: 16 }}>
                  <label className="field">
                    <span className="field-label">Диапазон отчёта: от</span>
                    <input
                      type="datetime-local"
                      value={slotRange.from}
                      onChange={(event) => setSlotRange((current) => ({ ...current, from: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Диапазон отчёта: до</span>
                    <input
                      type="datetime-local"
                      value={slotRange.to}
                      onChange={(event) => setSlotRange((current) => ({ ...current, to: event.target.value }))}
                    />
                  </label>
                </div>
              </section>
            </section>
          </>
        ) : null}

        {screen === "bookings" ? (
          <section className="panel">
            {renderCompactHeader("Заявки", "Здесь только неподтверждённые записи и активные переносы.", () => setScreen("home"), () => void loadBookings())}

            {visibleBookings.length === 0 ? (
              <div className="empty-state">
                <strong>На согласовании сейчас ничего нет</strong>
                <span>Новые заявки и переносы сразу появятся здесь.</span>
              </div>
            ) : (
              <div className="record-list trainer-record-list">
                {visibleBookings.map((item) => (
                    <article className="record-card workout-card" key={item.id}>
                      <div className="record-card-head workout-card__head">
                        <div>
                          <div className="workout-card__top">
                            <span className="workout-card__date">{formatShortDate(item.slot.startAt)}</span>
                            <span className="workout-card__time">{formatTime(item.slot.startAt)}</span>
                          </div>
                          <p className="record-meta">{item.client.fullName} · {item.client.phone || item.client.username || "без контакта"}</p>
                        </div>
                        <span className="status-pill workout-card__status" data-tone={getBookingTone(item.status)}>
                          {getBookingStatusLabel(item.status)}
                        </span>
                      </div>

                    {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                    {item.trainerComment ? <p className="record-comment">Комментарий тренера: {item.trainerComment}</p> : null}

                    {bookingProposalOpen[item.id] ? (
                      <div className="form-grid compact-stack">
                        <label className="field">
                          <span className="field-label">Комментарий тренера</span>
                          <textarea
                            value={bookingCommentDrafts[item.id] ?? ""}
                            onChange={(event) => setBookingCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Например: могу подтвердить на 30 минут раньше."
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Новое время для предложения</span>
                          <input
                            type="datetime-local"
                            value={bookingTimeDrafts[item.id] ?? ""}
                            onChange={(event) => setBookingTimeDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="record-actions workout-card__actions">
                      <a
                        className="action-btn action-btn--secondary action-btn--icon"
                        href={getClientContactHref(item.client)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Написать клиенту в Telegram"
                        title="Написать клиенту в Telegram"
                      >
                        <TelegramIcon />
                      </a>
                      <button className="action-btn action-btn--secondary" disabled={isBusy} onClick={() => void handleConfirmBooking(item.id)}>
                        Подтвердить
                      </button>
                      <button className="action-btn action-btn--danger-soft" disabled={isBusy} onClick={() => void handleRejectBookingQuick(item.id)}>
                        Отменить
                      </button>
                      {bookingProposalOpen[item.id] ? (
                        <>
                          <button className="action-btn action-btn--secondary" disabled={isBusy} onClick={() => void handleProposeBookingTimeFromCard(item.id)}>
                            Отправить новое время
                          </button>
                          <button
                            className="action-btn action-btn--secondary"
                            disabled={isBusy}
                            onClick={() => setBookingProposalOpen((current) => ({ ...current, [item.id]: false }))}
                          >
                            Скрыть
                          </button>
                        </>
                      ) : (
                        <button
                          className="action-btn action-btn--secondary"
                          disabled={isBusy}
                          onClick={() => setBookingProposalOpen((current) => ({ ...current, [item.id]: true }))}
                        >
                          Предложить другое время
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <section className="panel panel-subsection">
              <div className="panel-header panel-header-compact panel-header-slim">
                <div>
                  <h3 className="panel-title">Запросы без слота</h3>
                  <p className="panel-text">
                    Здесь тренер видит пожелания клиента по дням и времени, если в сетке не нашлось подходящего окна.
                    Комментарий сохраняется в карточке, а кнопка ниже открывает обычный Telegram-диалог, чтобы ответить клиенту лично.
                  </p>
                </div>
              </div>

              {activeNoSlotRequests.length === 0 ? (
                <div className="empty-state">
                  <strong>Запросов без слота сейчас нет</strong>
                  <span>Когда клиент оставит такой запрос, он появится в этом блоке заявок.</span>
                </div>
              ) : (
                <div className="record-list trainer-no-slot-list">
                  {activeNoSlotRequests.map((item) => (
                    <article className="record-card" key={item.id}>
                      <div className="record-card-head">
                        <div>
                          <h3 className="record-title">{item.client.fullName}</h3>
                          <p className="record-meta">{item.client.phone || item.client.username || `Telegram ID ${item.client.telegramId}`}</p>
                        </div>
                        <span className="status-pill" data-tone={item.status === "NEW" ? "pending" : "success"}>
                          {getNoSlotStatusLabel(item.status)}
                        </span>
                      </div>

                      <p className="record-comment">
                        Удобные дни: {item.preferredDays.map((day) => WEEKDAY_LABELS[day] ?? day).join(", ")}
                        {item.preferredTime ? ` · время: ${item.preferredTime}` : ""}
                      </p>
                      {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                      {item.client.note ? <p className="record-comment">Заметка клиента: {item.client.note}</p> : null}

                      <label className="field">
                        <span className="field-label">Комментарий тренера</span>
                        <textarea
                          value={noSlotCommentDrafts[item.id] ?? item.trainerComment ?? ""}
                          onChange={(event) => setNoSlotCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Например: могу предложить вторник в 18:00 или пятницу в 19:00."
                        />
                      </label>

                      <div className="record-actions">
                        <a className="status-button" href={getClientContactHref(item.client)} target="_blank" rel="noreferrer">
                          Написать в Telegram
                        </a>
                        <button className="primary-button" disabled={isBusy} onClick={() => void handleUpdateNoSlotRequest(item.id, "REVIEWED")}>
                          Сохранить комментарий
                        </button>
                        <button className="secondary-button" disabled={isBusy} onClick={() => void handleUpdateNoSlotRequest(item.id, "ARCHIVED")}>
                          Закрыть запрос
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        ) : false ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Заявки</h2>
                <p className="panel-text">Подтверждай, отклоняй, предлагай другое время или архивируй обработанные карточки.</p>
              </div>
              <button className="secondary-button" disabled={isBusy} onClick={() => void loadBookings()}>
                Обновить
              </button>
            </div>

            {bookings.length === 0 ? (
              <div className="empty-state">
                <strong>Активных заявок сейчас нет</strong>
                <span>Когда появятся новые заявки, они сразу попадут в этот список.</span>
              </div>
            ) : (
              <div className="record-list trainer-record-list">
                {bookings.map((item) => (
                  <article className="record-card" key={item.id}>
                    <div className="record-card-head">
                      <div>
                        <h3 className="record-title">{item.client.fullName}</h3>
                        <p className="record-meta">
                          {formatDateTime(item.slot.startAt)} до {formatTime(item.slot.endAt)} · {item.client.phone || item.client.username || "без контакта"}
                        </p>
                      </div>
                      <span className="status-pill" data-tone={getBookingTone(item.status)}>
                        {getBookingStatusLabel(item.status)}
                      </span>
                    </div>

                    {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                    {item.trainerComment ? <p className="record-comment">Комментарий тренера: {item.trainerComment}</p> : null}

                    <div className="form-grid compact-stack">
                      <label className="field">
                        <span className="field-label">Комментарий тренера</span>
                        <textarea
                          value={bookingCommentDrafts[item.id] ?? ""}
                          onChange={(event) => setBookingCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Например: могу подтвердить только если придёте на 30 минут раньше."
                        />
                      </label>

                      <label className="field">
                        <span className="field-label">Новое время для предложения</span>
                        <input
                          type="datetime-local"
                          value={bookingTimeDrafts[item.id] ?? ""}
                          onChange={(event) => setBookingTimeDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="record-actions">
                      <button className="primary-button" disabled={isBusy} onClick={() => void handleConfirmBooking(item.id)}>
                        Подтвердить
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleRejectBooking(item.id)}>
                        Отклонить
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleProposeBookingTime(item.id)}>
                        Предложить другое время
                      </button>
                      <button className="secondary-button" data-variant="danger" disabled={isBusy} onClick={() => void handleArchiveBooking(item.id)}>
                        Архивировать
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {screen === "trainings" ? (
          <section className="panel">
            {renderCompactHeader(
              "Тренировки",
              "Все тренировки в выбранном диапазоне: подтверждённые, отменённые и перенесённые.",
              () => setScreen("home"),
              () => void loadTrainings(),
              <button
                className="secondary-button secondary-button-compact icon-button-compact"
                aria-label="Пересинхронизировать календарь"
                title="Пересинхронизировать календарь"
                disabled={isBusy}
                onClick={() => void handleResyncAllTrainings()}
              >
                <CalendarIcon />
              </button>,
            )}

            {trainings.length === 0 ? (
              <div className="empty-state">
                <strong>В этом диапазоне тренировок нет</strong>
                <span>Попробуйте обновить список или проверить горизонт в настройках.</span>
              </div>
            ) : (
              <div className="record-list trainer-record-list">
                {sortedTrainings.map((item) => (
                    <article className="record-card workout-card" key={item.trainingId}>
                      <div className="record-card-head workout-card__head">
                        <div>
                          <div className="workout-card__top">
                            <span className="workout-card__date">{formatShortDate(item.startAt)}</span>
                            <span className="workout-card__time">{formatTime(item.startAt)}</span>
                          </div>
                          <p className="record-meta">{item.client.fullName} · {item.client.phone || item.client.username || "без контакта"}</p>
                        </div>
                        <div className="record-card-head-actions">
                          <span className="status-pill workout-card__status" data-tone={getBookingTone(item.bookingStatus)}>
                            {getBookingStatusLabel(item.bookingStatus)}
                          </span>
                          {item.bookingStatus !== "CANCELLED" ? (
                            <button
                              className="action-btn action-btn--secondary calendar-icon-button"
                              aria-label="Файл календаря"
                              title="Файл календаря"
                              disabled={isBusy}
                              onClick={() => void handleDownloadBookingCalendarFile(item.bookingId, item.startAt)}
                            >
                              <CalendarIcon />
                            </button>
                          ) : null}
                        </div>
                    </div>

                    {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                    {item.trainerComment ? <p className="record-comment">Комментарий тренера: {item.trainerComment}</p> : null}
                    {item.client.note ? <p className="record-comment">Заметка клиента: {item.client.note}</p> : null}

                    {trainingProposalOpen[item.bookingId] ? (
                      <div className="form-grid compact-stack">
                        <label className="field">
                          <span className="field-label">Комментарий к переносу</span>
                          <textarea
                            value={trainingCommentDrafts[item.bookingId] ?? ""}
                            onChange={(event) => setTrainingCommentDrafts((current) => ({ ...current, [item.bookingId]: event.target.value }))}
                            placeholder="Например: предлагаю другое время из-за накладки."
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Новое время</span>
                          <input
                            type="datetime-local"
                            value={trainingTimeDrafts[item.bookingId] ?? ""}
                            onChange={(event) => setTrainingTimeDrafts((current) => ({ ...current, [item.bookingId]: event.target.value }))}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="record-actions workout-card__actions">
                      <a
                        className="action-btn action-btn--secondary action-btn--icon"
                        href={getClientContactHref(item.client)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Написать клиенту в Telegram"
                        title="Написать клиенту в Telegram"
                      >
                        <TelegramIcon />
                      </a>
                      {item.bookingStatus !== "CANCELLED" ? (
                        <button className="action-btn action-btn--danger-soft" disabled={isBusy} onClick={() => void handleCancelTraining(item.bookingId)}>
                          Отменить
                        </button>
                      ) : null}
                      {item.bookingStatus !== "CANCELLED" && trainingProposalOpen[item.bookingId] ? (
                        <>
                          <button className="action-btn action-btn--secondary" disabled={isBusy} onClick={() => void handleRescheduleTrainingFromCard(item.bookingId)}>
                            Отправить перенос
                          </button>
                          <button
                            className="action-btn action-btn--secondary"
                            disabled={isBusy}
                            onClick={() => setTrainingProposalOpen((current) => ({ ...current, [item.bookingId]: false }))}
                          >
                            Скрыть
                          </button>
                        </>
                      ) : item.bookingStatus !== "CANCELLED" ? (
                        <button
                          className="action-btn action-btn--secondary"
                          disabled={isBusy}
                          onClick={() => setTrainingProposalOpen((current) => ({ ...current, [item.bookingId]: true }))}
                        >
                          Предложить перенос
                        </button>
                      ) : null}
                      <button className="action-btn action-btn--danger-soft" disabled={isBusy} onClick={() => void handleForceCloseTraining(item.bookingId)}>
                        Удалить
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : false ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Будущие тренировки</h2>
                <p className="panel-text">Работай с подтверждёнными тренировками и активными переносами в выбранном диапазоне.</p>
              </div>
              <button className="secondary-button" disabled={isBusy} onClick={() => void loadTrainings()}>
                Обновить
              </button>
            </div>

            {trainings.length === 0 ? (
              <div className="empty-state">
                <strong>В этом диапазоне тренировок нет</strong>
                <span>Попробуй обновить диапазон на главной или открыть слоты на новые дни.</span>
              </div>
            ) : (
              <div className="record-list">
                {sortedTrainings.map((item) => (
                  <article className="record-card" key={item.trainingId}>
                    <div className="record-card-head">
                      <div>
                        <h3 className="record-title">{item.client.fullName}</h3>
                        <p className="record-meta">
                          {formatDateTime(item.startAt)} до {formatTime(item.endAt)} · {item.client.phone || item.client.username || "без контакта"}
                        </p>
                      </div>
                      <span className="status-pill" data-tone={getBookingTone(item.bookingStatus)}>
                        {getBookingStatusLabel(item.bookingStatus)}
                      </span>
                    </div>

                    {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                    {item.trainerComment ? <p className="record-comment">Комментарий тренера: {item.trainerComment}</p> : null}
                    {item.client.note ? <p className="record-comment">Заметка клиента: {item.client.note}</p> : null}

                    <div className="form-grid compact-stack">
                      <label className="field">
                        <span className="field-label">Комментарий тренера</span>
                        <textarea
                          value={trainingCommentDrafts[item.bookingId] ?? ""}
                          onChange={(event) => setTrainingCommentDrafts((current) => ({ ...current, [item.bookingId]: event.target.value }))}
                          placeholder="Например: предлагаю другое время из-за накладки в расписании."
                        />
                      </label>

                      <label className="field">
                        <span className="field-label">Новое время для переноса</span>
                        <input
                          type="datetime-local"
                          value={trainingTimeDrafts[item.bookingId] ?? ""}
                          onChange={(event) => setTrainingTimeDrafts((current) => ({ ...current, [item.bookingId]: event.target.value }))}
                        />
                      </label>
                    </div>

                    <div className="record-actions">
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleCancelTraining(item.bookingId)}>
                        Отменить
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleRescheduleTraining(item.bookingId)}>
                        Предложить перенос
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleResyncTraining(item.bookingId)}>
                        Ресинк календаря
                      </button>
                      <button className="secondary-button" data-variant="danger" disabled={isBusy} onClick={() => void handleForceCloseTraining(item.bookingId)}>
                        Жёстко закрыть
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {screen === "slots" ? (
          <section className="panel">
            {renderCompactHeader("Слоты", "Нажимай по часу, чтобы открыть или закрыть слот. Для диапазонов используй форму ниже.", () => setScreen("settings"), () => void loadSlots())}

            <div className="form-grid form-grid-split">
              <label className="field">
                <span className="field-label">Показать слоты от</span>
                <input
                  type="date"
                  value={slotRange.from.slice(0, 10)}
                  onChange={(event) => setSlotRange((current) => ({ ...current, from: `${event.target.value}T00:00` }))}
                />
              </label>
              <label className="field">
                <span className="field-label">Показать слоты до</span>
                <input
                  type="date"
                  value={slotRange.to.slice(0, 10)}
                  onChange={(event) => setSlotRange((current) => ({ ...current, to: `${event.target.value}T23:00` }))}
                />
              </label>
            </div>

            <div className="slot-legend">
              <span className="status-pill" data-tone="success">Открыт</span>
              <span className="status-pill" data-tone="danger">Закрыт</span>
            </div>

            {slotGroups.length === 0 ? (
              <div className="empty-state">
                <strong>В выбранном диапазоне пока нечего показать</strong>
                <span>Обнови период или открой первые слоты через форму диапазона.</span>
              </div>
            ) : (
              <div className="booking-groups">
                {slotGroups.map((group) => (
                  <section className="slot-day" key={group.dayKey}>
                    <div className="slot-day-header">
                      <h3 className="slot-day-title">{group.title}</h3>
                    </div>
                    <div className="time-grid">
                      {group.items.map((slot) => (
                        <button
                          key={slot.id}
                          className="time-button"
                          data-slot-status={slot.status.toLowerCase()}
                          disabled={isBusy || slot.status === "BOOKED" || slot.status === "HELD"}
                          onClick={() => void handleToggleSlot(slot)}
                          title={slot.status}
                        >
                          {formatTime(slot.startAt)}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            <section className="panel panel-subsection">
              <div className="panel-header">
                <div>
                  <h3 className="panel-title">Диапазонное управление</h3>
                  <p className="panel-text">Можно открыть, закрыть или переоткрыть сразу несколько часов подряд.</p>
                </div>
              </div>

              <div className="form-grid form-grid-split">
                <label className="field">
                  <span className="field-label">Начало</span>
                  <input
                    type="datetime-local"
                    value={bulkSlotForm.startAt}
                    onChange={(event) => setBulkSlotForm((current) => ({ ...current, startAt: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Конец</span>
                  <input
                    type="datetime-local"
                    value={bulkSlotForm.endAt}
                    onChange={(event) => setBulkSlotForm((current) => ({ ...current, endAt: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Причина закрытия</span>
                  <input
                    value={bulkSlotForm.reason}
                    onChange={(event) => setBulkSlotForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Например: отпуск, соревнования, личное окно"
                  />
                </label>
              </div>

              <div className="record-actions">
                <button className="primary-button" disabled={isBusy} onClick={() => void handleBulkOpenSlots()}>
                  Открыть диапазон
                </button>
                <button className="secondary-button" disabled={isBusy} onClick={() => void handleBulkCloseSlots()}>
                  Закрыть диапазон
                </button>
                <button className="secondary-button" disabled={isBusy} onClick={() => void handleBulkReopenSlots()}>
                  Переоткрыть диапазон
                </button>
              </div>
            </section>

          </section>
        ) : null}

        {screen === "clients" ? (
          <section className="panel">
            {renderCompactHeader("Клиенты и чёрный список", "Ищи по имени, телефону или username и сразу управляй доступом к записи.", () => setScreen("settings"))}

            <div className="search-row">
              <input
                value={clientSearchQuery}
                onChange={(event) => setClientSearchQuery(event.target.value)}
                placeholder="Имя, телефон или @username"
              />
              <button className="primary-button" disabled={isBusy} onClick={() => void handleSearchClients()}>
                Найти
              </button>
            </div>

            {clientResults.length > 0 ? (
              <div className="record-list trainer-clients-list" style={{ marginTop: 16 }}>
                {clientResults.map((client) => (
                  <article className="record-card" key={client.id}>
                    <div className="record-card-head">
                      <div>
                        <h3 className="record-title">{client.fullName}</h3>
                        <p className="record-meta">{client.phone || client.username || `Telegram ID ${client.telegramId}`}</p>
                      </div>
                      <span className="status-pill" data-tone={client.isBlacklisted ? "danger" : "success"}>
                        {client.isBlacklisted ? "В чёрном списке" : "Активен"}
                      </span>
                    </div>

                    {client.note ? <p className="record-comment">Заметка клиента: {client.note}</p> : null}

                    <label className="field">
                      <span className="field-label">Причина для чёрного списка</span>
                      <input
                        value={blacklistReasonDrafts[client.id] ?? ""}
                        onChange={(event) => setBlacklistReasonDrafts((current) => ({ ...current, [client.id]: event.target.value }))}
                        placeholder="Например: неоднократные отмены в последний момент"
                      />
                    </label>

                    <div className="record-actions">
                      <a className="status-button" href={getClientContactHref(client)} target="_blank" rel="noreferrer">
                        Написать в Telegram
                      </a>
                      {client.isBlacklisted ? (
                        <button className="secondary-button" disabled={isBusy} onClick={() => void handleRemoveFromBlacklist(client.id)}>
                          Убрать из чёрного списка
                        </button>
                      ) : (
                        <button className="secondary-button" data-variant="danger" disabled={isBusy} onClick={() => void handleAddToBlacklist(client.id)}>
                          Добавить в чёрный список
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ marginTop: 16 }}>
                <strong>Поиск пока пуст</strong>
                <span>Введи имя, номер телефона или username, чтобы открыть карточки клиентов.</span>
              </div>
            )}

            <section className="panel panel-subsection">
              <div className="panel-header panel-header-compact panel-header-slim">
                <div>
                  <h3 className="panel-title">Текущий чёрный список</h3>
                  <p className="panel-text">Эти клиенты сейчас не смогут создавать новые заявки и запросы без слота.</p>
                </div>
                <div className="panel-header-actions">
                  <button
                    className="secondary-button secondary-button-compact icon-button-compact"
                    aria-label="Обновить чёрный список"
                    title="Обновить"
                    disabled={isBusy}
                    onClick={() => void loadBlacklist()}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </div>

              {blacklist.length === 0 ? (
                <div className="empty-state">
                  <strong>Чёрный список пуст</strong>
                </div>
              ) : (
                <div className="record-list trainer-clients-list">
                  {blacklist.map((client) => (
                    <article className="record-card" key={client.id}>
                      <h3 className="record-title">{client.fullName}</h3>
                      <p className="record-meta">{client.blacklistReason || "Причина не указана"}</p>
                      <div className="record-actions">
                        <button className="secondary-button" disabled={isBusy} onClick={() => void handleRemoveFromBlacklist(client.id)}>
                          Убрать из чёрного списка
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>
        ) : null}

        {screen === "settings" ? (
          <section className="panel">
            {renderCompactHeader("Настройки", "Здесь собраны поиск клиентов, чёрный список, слоты и параметры записи.", () => setScreen("home"), () => void loadSettings())}

            <section className="panel panel-subsection">
              <div className="panel-header">
                <div>
                  <h3 className="panel-title">Параметры записи</h3>
                  <p className="panel-text">Сначала настраивается горизонт, ограничение записи и режим работы, а уже потом открываются слоты.</p>
                </div>
              </div>

              <div className="form-grid form-grid-split">
                <label className="field">
                  <span className="field-label">Горизонт записи, дней</span>
                  <input
                    value={settingsForm.bookingHorizonDays}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, bookingHorizonDays: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span className="field-label">Ограничение на запись день-в-день, часов</span>
                  <input
                    value={settingsForm.sameDayBookingCutoff}
                    onChange={(event) => setSettingsForm((current) => ({ ...current, sameDayBookingCutoff: event.target.value }))}
                  />
                </label>
              </div>

              <div className="form-grid form-grid-split">
                <div className="field">
                  <span className="field-label">Режим работы: дни</span>
                  <div className="chips-wrap">
                    {WEEKDAY_ORDER.map((day) => {
                      const active = settingsForm.workingDays.includes(day);
                      return (
                        <button
                          className="chip-button"
                          data-active={active ? "true" : "false"}
                          key={day}
                          onClick={() => toggleWorkingDay(day)}
                          type="button"
                        >
                          {WEEKDAY_LABELS[day]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">Режим работы: время</span>
                  <div className="form-grid form-grid-split">
                    <label className="field">
                      <span className="field-label">С</span>
                      <select
                        value={settingsForm.workdayStartHour}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, workdayStartHour: event.target.value }))}
                      >
                        {HOUR_OPTIONS.map((hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">До</span>
                      <select
                        value={settingsForm.workdayEndHour}
                        onChange={(event) => setSettingsForm((current) => ({ ...current, workdayEndHour: event.target.value }))}
                      >
                        {[...HOUR_OPTIONS, 24].map((hour) => (
                          <option key={hour} value={hour}>
                            {hour === 24 ? "24:00" : `${String(hour).padStart(2, "0")}:00`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="record-actions">
                <button className="primary-button" disabled={isBusy} onClick={() => void handleSaveSettings()}>
                  Сохранить настройки
                </button>
              </div>

              {settingsMeta ? <p className="record-comment">Последнее обновление: {formatDateTime(settingsMeta.updatedAt)}</p> : null}
            </section>

            <div className="home-actions-grid">
              <article className="action-card action-card-home">
                <span className="badge">{slotGroups.length} дней</span>
                <strong>Слоты</strong>
                <p>Открывайте и закрывайте время, управляйте диапазонами и окнами.</p>
                <button className="primary-button" onClick={() => setScreen("slots")}>
                  Открыть слоты
                </button>
              </article>

              <article className="action-card action-card-home">
                <span className="badge">{blacklist.length} в чёрном списке</span>
                <strong>Клиенты и чёрный список</strong>
                <p>Ищите клиентов, управляйте ограничениями и быстро находите карточки.</p>
                <button className="primary-button" onClick={() => setScreen("clients")}>
                  Открыть клиентов
                </button>
              </article>
            </div>
          </section>
        ) : false ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Настройки записи</h2>
                <p className="panel-text">Управляй горизонтом записи и ограничением на запись день-в-день.</p>
              </div>
              <button className="secondary-button" disabled={isBusy} onClick={() => void loadSettings()}>
                Обновить
              </button>
            </div>

            <div className="form-grid form-grid-split">
              <label className="field">
                <span className="field-label">Горизонт записи, дней</span>
                <input
                  value={settingsForm.bookingHorizonDays}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, bookingHorizonDays: event.target.value }))}
                />
              </label>

              <label className="field">
                <span className="field-label">Cutoff на запись день-в-день, часов</span>
                <input
                  value={settingsForm.sameDayBookingCutoff}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, sameDayBookingCutoff: event.target.value }))}
                />
              </label>
            </div>

            <div className="record-actions">
              <button className="primary-button" disabled={isBusy} onClick={() => void handleSaveSettings()}>
                Сохранить настройки
              </button>
              <button className="secondary-button" disabled={isBusy} onClick={() => void handleExport()}>
                Выгрузить CSV
              </button>
            </div>

            {settingsMeta ? (
              <p className="record-comment">Последнее обновление: {formatDateTime(settingsMeta.updatedAt)}</p>
            ) : null}
          </section>
        ) : null}

        {screen === "no-slot" ? (
          <section className="panel">
            {renderCompactHeader("Запросы без слота", "Клиенты оставляют пожелания по дням и времени, когда в сетке нет подходящего окна.", () => setScreen("settings"), () => void loadNoSlotRequests())}

            {noSlotRequests.length === 0 ? (
              <div className="empty-state">
                <strong>Запросов без слота пока нет</strong>
              </div>
            ) : (
              <div className="record-list trainer-no-slot-list">
                {noSlotRequests.map((item) => (
                  <article className="record-card" key={item.id}>
                    <div className="record-card-head">
                      <div>
                        <h3 className="record-title">{item.client.fullName}</h3>
                        <p className="record-meta">{item.client.phone || item.client.username || `Telegram ID ${item.client.telegramId}`}</p>
                      </div>
                      <span className="status-pill" data-tone={item.status === "NEW" ? "pending" : item.status === "ARCHIVED" ? "muted" : "success"}>
                        {getNoSlotStatusLabel(item.status)}
                      </span>
                    </div>

                    <p className="record-comment">
                      Удобные дни: {item.preferredDays.map((day) => WEEKDAY_LABELS[day] ?? day).join(", ")}
                      {item.preferredTime ? ` · время: ${item.preferredTime}` : ""}
                    </p>
                    {item.clientComment ? <p className="record-comment">Комментарий клиента: {item.clientComment}</p> : null}
                    {item.client.note ? <p className="record-comment">Заметка клиента: {item.client.note}</p> : null}

                    <label className="field">
                      <span className="field-label">Комментарий тренера</span>
                      <textarea
                        value={noSlotCommentDrafts[item.id] ?? item.trainerComment ?? ""}
                        onChange={(event) => setNoSlotCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Например: предложу варианты после 18:00 в ближайшие два дня."
                      />
                    </label>

                    <div className="record-actions">
                      <button className="primary-button" disabled={isBusy} onClick={() => void handleUpdateNoSlotRequest(item.id, "REVIEWED")}>
                        Пометить в работе
                      </button>
                      <button className="secondary-button" disabled={isBusy} onClick={() => void handleUpdateNoSlotRequest(item.id, "ARCHIVED")}>
                        Архивировать
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {screen === "profile" ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Профиль доступа</h2>
                <p className="panel-text">Тренерский контур использует Telegram Mini App session и отдельный логин не нужен.</p>
              </div>
            </div>

            <div className="form-grid">
              <div className="field">
                <span className="field-label">Имя в сессии</span>
                <input value={trainerName} readOnly />
              </div>
              <div className="field">
                <span className="field-label">Telegram ID</span>
                <input value={session.session.telegramId} readOnly />
              </div>
              <div className="field">
                <span className="field-label">Username</span>
                <input value={session.session.username ?? ""} readOnly />
              </div>
            </div>
          </section>
        ) : null}

        {screen === "support" ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Подсказки</h2>
                <p className="panel-text">Короткие ориентиры по первой версии тренерского mini app.</p>
              </div>
            </div>

            <ul className="support-list">
              <li>Заявки клиентов и запросы без слота теперь можно обрабатывать прямо в mini app, без поиска сообщений в боте.</li>
              <li>Часть системных уведомлений в первой версии всё ещё остаётся в Telegram-боте как в резервном канале.</li>
              <li>Для диапазонного управления слотами используй форму с датой, временем и причиной закрытия.</li>
              <li>CSV-выгрузка собирает заявки, будущие тренировки и запросы без слота в один отчёт.</li>
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
