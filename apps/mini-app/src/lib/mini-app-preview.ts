import type {
  AvailableSlot,
  BookingStatusType,
  ClientProfile,
  ClientTrainingDto,
  MiniAppMeResponse,
  MiniAppRole,
  MiniAppSession,
  NoSlotRequestDto,
  NoSlotRequestStatusType,
  PendingBookingDto,
  SlotClosureInfo,
  TrainerSettingsDto,
  TrainerTrainingDto,
} from "./mini-app-api";

type SessionResponse = {
  status: "ok";
  token: string;
  session: MiniAppSession;
};

type UpdateProfileResponse = {
  status: "updated";
  profile: ClientProfile;
};

type CreateBookingResponse = {
  status: "created";
  booking: {
    id: string;
    slotId: string;
    status: BookingStatusType;
    expiresAt: string;
    startAt: string;
    endAt: string;
  };
};

type BookingActionResponse = {
  status: "confirmed" | "rejected" | "proposed" | "cancelled" | "rescheduled" | "resynced" | "archived";
  booking?: PendingBookingDto;
};

type TrainerSettingsResponse = {
  status: "ok" | "updated";
  settings: TrainerSettingsDto;
};

type ClientsResponse = {
  status: "ok";
  items: ClientProfile[];
};

type NoSlotRequestsResponse = {
  status: "ok";
  items: NoSlotRequestDto[];
};

type PreviewTokenPayload = {
  role: MiniAppRole;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
};

type PreviewBookingRecord = {
  id: string;
  clientId: string;
  status: BookingStatusType;
  trainingStatus: TrainerTrainingDto["trainingStatus"] | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  expiresAt: string;
  clientComment: string | null;
  trainerComment: string | null;
  proposedStartAt: string | null;
  archivedByClient: boolean;
  archivedByTrainer: boolean;
};

type PreviewNoSlotRequestRecord = {
  id: string;
  clientId: string;
  status: NoSlotRequestStatusType;
  preferredDays: string[];
  preferredTime: string | null;
  clientComment: string | null;
  trainerComment: string | null;
  createdAt: string;
};

type PreviewState = {
  settings: TrainerSettingsDto;
  clients: ClientProfile[];
  bookings: PreviewBookingRecord[];
  noSlotRequests: PreviewNoSlotRequestRecord[];
  manualClosedSlots: string[];
};

const PREVIEW_STORAGE_KEY = "tvoy-box-mini-app-preview-state-v1";
const PREVIEW_SUPPORT_URL = "https://t.me/RostPV";
const PREVIEW_SUPPORT_ID = "492732093";
const PREVIEW_WORKING_DAYS = ["monday", "wednesday", "friday"];
const PREVIEW_CLIENT_ID = "preview-client-demo";
const PREVIEW_CLIENT_TELEGRAM_ID = "7000000001";
const PREVIEW_TRAINER_TELEGRAM_ID = "492732093";
const MOSCOW_TIME_ZONE = "Europe/Moscow";
const HOUR_MS = 60 * 60 * 1000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function isLocalPreviewEnvironment(): boolean {
  return isBrowser() && ["127.0.0.1", "localhost"].includes(window.location.hostname);
}

function makePreviewToken(payload: PreviewTokenPayload): string {
  return [
    "preview",
    payload.role,
    payload.telegramId,
    payload.username ?? "",
    encodeURIComponent(payload.firstName),
    encodeURIComponent(payload.lastName ?? ""),
  ].join("|");
}

function parsePreviewToken(token: string): PreviewTokenPayload {
  const [prefix, role, telegramId, username, firstName, lastName] = token.split("|");
  if (prefix !== "preview" || (role !== "client" && role !== "trainer") || !telegramId) {
    throw new Error("Нет активной mini app сессии");
  }

  return {
    role,
    telegramId,
    username: username || null,
    firstName: decodeURIComponent(firstName || "Демо"),
    lastName: decodeURIComponent(lastName || "") || null,
  };
}

function createMoscowIso(dateKey: string, timeLabel: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = timeLabel.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours - 3, minutes, 0, 0)).toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function formatDateKeyInMoscow(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function getWeekdayKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();

  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][weekday];
}

function addDays(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function getPreviewHorizonEndIso(now: Date, days: number): string {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 14;
  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);
  endDate.setDate(endDate.getDate() + safeDays);
  return endDate.toISOString();
}

function enumerateDateKeys(fromIso: string, toIso: string): string[] {
  const fromKey = formatDateKeyInMoscow(fromIso);
  const toKey = formatDateKeyInMoscow(toIso);
  const result: string[] = [];

  let cursor = fromKey;
  while (cursor <= toKey) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return result;
}

function makeClientProfile(params: {
  id: string;
  telegramId: string;
  username: string | null;
  fullName: string;
  phone?: string | null;
  note?: string | null;
  consentAcceptedAt?: string | null;
  isBlacklisted?: boolean;
  blacklistReason?: string | null;
}): ClientProfile {
  return {
    id: params.id,
    telegramId: params.telegramId,
    username: params.username,
    fullName: params.fullName,
    phone: params.phone ?? null,
    note: params.note ?? null,
    consentAcceptedAt: params.consentAcceptedAt ?? null,
    isBlacklisted: params.isBlacklisted ?? false,
    blacklistReason: params.blacklistReason ?? null,
    blacklistedAt: params.isBlacklisted ? new Date().toISOString() : null,
  };
}

function buildDefaultPreviewState(): PreviewState {
  const now = new Date().toISOString();

  return {
    settings: {
      bookingHorizonDays: 14,
      sameDayBookingCutoff: 2,
      workingDays: [...PREVIEW_WORKING_DAYS],
      workdayStartHour: 9,
      workdayEndHour: 12,
      updatedAt: now,
    },
    clients: [
      makeClientProfile({
        id: PREVIEW_CLIENT_ID,
        telegramId: PREVIEW_CLIENT_TELEGRAM_ID,
        username: "demo_client",
        fullName: "Демо Клиент",
        phone: "+7 999 123-45-67",
        note: "Удобно писать в Telegram.",
        consentAcceptedAt: now,
      }),
      makeClientProfile({
        id: "preview-client-anna",
        telegramId: "7000000002",
        username: "AlTobolova",
        fullName: "Анна",
        phone: "+7 999 000-11-22",
        note: null,
      }),
    ],
    bookings: [
      {
        id: "preview-booking-pending-1",
        clientId: PREVIEW_CLIENT_ID,
        status: "PENDING",
        trainingStatus: null,
        startAt: createMoscowIso("2026-05-22", "10:00"),
        endAt: createMoscowIso("2026-05-22", "11:00"),
        createdAt: now,
        expiresAt: addMinutes(now, 30),
        clientComment: "Хочу попробовать первую тренировку.",
        trainerComment: null,
        proposedStartAt: null,
        archivedByClient: false,
        archivedByTrainer: false,
      },
      {
        id: "preview-booking-pending-2",
        clientId: PREVIEW_CLIENT_ID,
        status: "PENDING",
        trainingStatus: null,
        startAt: createMoscowIso("2026-05-27", "10:00"),
        endAt: createMoscowIso("2026-05-27", "11:00"),
        createdAt: now,
        expiresAt: addMinutes(now, 30),
        clientComment: "Подходит утреннее время.",
        trainerComment: null,
        proposedStartAt: null,
        archivedByClient: false,
        archivedByTrainer: false,
      },
      {
        id: "preview-booking-confirmed-1",
        clientId: PREVIEW_CLIENT_ID,
        status: "CONFIRMED",
        trainingStatus: "SCHEDULED",
        startAt: createMoscowIso("2026-05-26", "10:00"),
        endAt: createMoscowIso("2026-05-26", "11:00"),
        createdAt: now,
        expiresAt: addMinutes(now, 30),
        clientComment: null,
        trainerComment: "Жду на тренировке.",
        proposedStartAt: null,
        archivedByClient: false,
        archivedByTrainer: false,
      },
      {
        id: "preview-booking-cancelled-1",
        clientId: PREVIEW_CLIENT_ID,
        status: "CANCELLED",
        trainingStatus: "CANCELLED",
        startAt: createMoscowIso("2026-05-25", "09:00"),
        endAt: createMoscowIso("2026-05-25", "10:00"),
        createdAt: now,
        expiresAt: addMinutes(now, 30),
        clientComment: "Клиент перенес тренировку",
        trainerComment: "Клиент отменил тренировку",
        proposedStartAt: null,
        archivedByClient: false,
        archivedByTrainer: false,
      },
    ],
    noSlotRequests: [
      {
        id: "preview-no-slot-1",
        clientId: "preview-client-anna",
        status: "NEW",
        preferredDays: ["monday", "friday"],
        preferredTime: "После 18:00",
        clientComment: "Если появится вечернее окно, напишите мне.",
        trainerComment: null,
        createdAt: now,
      },
    ],
    manualClosedSlots: [],
  };
}

function readPreviewState(): PreviewState {
  if (!isBrowser()) {
    return buildDefaultPreviewState();
  }

  try {
    const raw = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) {
      const initial = buildDefaultPreviewState();
      window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    return JSON.parse(raw) as PreviewState;
  } catch {
    const initial = buildDefaultPreviewState();
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

function writePreviewState(state: PreviewState): void {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state));
}

function findClient(state: PreviewState, clientId: string): ClientProfile {
  const client = state.clients.find((item) => item.id === clientId);
  if (!client) {
    throw new Error("Клиент не найден.");
  }

  return client;
}

function getSessionFromToken(token: string): MiniAppSession {
  const payload = parsePreviewToken(token);
  const now = Math.floor(Date.now() / 1000);

  return {
    telegramId: payload.telegramId,
    username: payload.username,
    firstName: payload.firstName,
    lastName: payload.lastName,
    photoUrl: null,
    role: payload.role,
    iat: now,
    exp: now + 60 * 60 * 24,
  };
}

function getMeResponse(state: PreviewState, token: string): MiniAppMeResponse {
  const session = getSessionFromToken(token);
  const profile = session.role === "client"
    ? state.clients.find((item) => item.telegramId === session.telegramId) ?? null
    : null;

  return {
    status: "ok",
    session,
    profile,
    needsProfileCompletion: session.role === "client" ? !profile?.phone : false,
    supportContact: {
      telegramId: PREVIEW_SUPPORT_ID,
      telegramUrl: PREVIEW_SUPPORT_URL,
      label: "Написать тренеру",
    },
  };
}

function makeSlotId(startAt: string): string {
  return `preview-slot|${startAt}`;
}

function parseSlotId(slotId: string): string {
  return slotId.replace(/^preview-slot\|/, "");
}

function isActiveSlotStatus(status: BookingStatusType, trainingStatus: TrainerTrainingDto["trainingStatus"] | null): boolean {
  if (status === "PENDING" || status === "RESCHEDULED") {
    return true;
  }

  return status === "CONFIRMED" && trainingStatus !== "CANCELLED";
}

function buildPreviewSlots(state: PreviewState, fromIso: string, toIso: string): AvailableSlot[] {
  const result: AvailableSlot[] = [];
  const dateKeys = enumerateDateKeys(fromIso, toIso);

  for (const dateKey of dateKeys) {
    const weekday = getWeekdayKey(dateKey);
    if (!state.settings.workingDays.includes(weekday)) {
      continue;
    }

    for (let hour = state.settings.workdayStartHour; hour < state.settings.workdayEndHour; hour += 1) {
      const startAt = createMoscowIso(dateKey, `${String(hour).padStart(2, "0")}:00`);
      const endAt = addMinutes(startAt, 60);
      if (startAt < fromIso || startAt > toIso) {
        continue;
      }

      const activeBooking = state.bookings.find((item) => item.startAt === startAt && !item.archivedByTrainer && isActiveSlotStatus(item.status, item.trainingStatus));
      const manuallyClosed = state.manualClosedSlots.includes(startAt);
      const status: AvailableSlot["status"] = manuallyClosed
        ? "CLOSED"
        : activeBooking?.status === "CONFIRMED"
          ? "BOOKED"
          : activeBooking
            ? "HELD"
            : "OPEN";

      result.push({
        id: makeSlotId(startAt),
        startAt,
        endAt,
        status,
      });
    }
  }

  return result;
}

function buildPendingBooking(state: PreviewState, booking: PreviewBookingRecord): PendingBookingDto {
  const client = findClient(state, booking.clientId);
  const slotStatus: AvailableSlot["status"] = booking.status === "CONFIRMED"
    ? "BOOKED"
    : booking.status === "PENDING" || booking.status === "RESCHEDULED"
      ? "HELD"
      : "CLOSED";

  return {
    id: booking.id,
    status: booking.status,
    createdAt: booking.createdAt,
    expiresAt: booking.expiresAt,
    clientComment: booking.clientComment,
    trainerComment: booking.trainerComment,
    client: {
      id: client.id,
      telegramId: client.telegramId,
      fullName: client.fullName,
      username: client.username,
      phone: client.phone,
    },
    slot: {
      id: makeSlotId(booking.startAt),
      startAt: booking.startAt,
      endAt: booking.endAt,
      status: slotStatus,
    },
  };
}

function buildTrainerTraining(state: PreviewState, booking: PreviewBookingRecord): TrainerTrainingDto {
  const client = findClient(state, booking.clientId);

  return {
    bookingId: booking.id,
    trainingId: `training-${booking.id}`,
    bookingStatus: booking.status,
    trainingStatus: booking.trainingStatus ?? "SCHEDULED",
    startAt: booking.startAt,
    endAt: booking.endAt,
    clientCalendarIcsUrl: null,
    trainerComment: booking.trainerComment,
    clientComment: booking.clientComment,
    client,
    canCancel: booking.trainingStatus !== "CANCELLED",
    canReschedule: booking.trainingStatus !== "CANCELLED",
    canResyncCalendar: booking.status === "CONFIRMED",
  };
}

function buildClientTraining(booking: PreviewBookingRecord): ClientTrainingDto {
  const hasTrainerProposal = booking.status === "RESCHEDULED" && Boolean(booking.proposedStartAt);
  const isAwaitingTrainerDecision = booking.status === "PENDING" || (booking.status === "RESCHEDULED" && !hasTrainerProposal);

  return {
    bookingId: booking.id,
    bookingStatus: booking.status,
    trainingStatus: booking.trainingStatus,
    startAt: booking.startAt,
    endAt: booking.endAt,
    clientCalendarIcsUrl: null,
    trainerComment: booking.trainerComment,
    clientComment: booking.clientComment,
    isAwaitingTrainerDecision,
    hasTrainerProposal,
    canCancel: booking.status === "PENDING" || booking.status === "CONFIRMED" || booking.status === "RESCHEDULED",
    canReschedule: booking.status === "CONFIRMED",
    canDelete: !isAwaitingTrainerDecision,
  };
}

function autoArchivePastPreviewBookings(state: PreviewState): boolean {
  const nowMs = Date.now();
  let changed = false;

  state.bookings = state.bookings.map((item) => {
    const isPastTraining = item.trainingStatus !== null && new Date(item.endAt).getTime() <= nowMs;
    if (!isPastTraining || (item.archivedByClient && item.archivedByTrainer)) {
      return item;
    }

    changed = true;
    return {
      ...item,
      archivedByClient: true,
      archivedByTrainer: true,
    };
  });

  return changed;
}

function buildNoSlotRequest(state: PreviewState, request: PreviewNoSlotRequestRecord): NoSlotRequestDto {
  return {
    id: request.id,
    status: request.status,
    preferredDays: request.preferredDays,
    preferredTime: request.preferredTime,
    clientComment: request.clientComment,
    trainerComment: request.trainerComment,
    createdAt: request.createdAt,
    client: findClient(state, request.clientId),
  };
}

function createCalendarBlob(title: string, startAt: string, endAt: string): Blob {
  const toCalendarUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tvoy Box//Mini App Preview//RU",
    "BEGIN:VEVENT",
    `UID:${title.replace(/\s+/g, "-").toLowerCase()}-${toCalendarUtc(startAt)}`,
    `DTSTAMP:${toCalendarUtc(new Date().toISOString())}`,
    `DTSTART:${toCalendarUtc(startAt)}`,
    `DTEND:${toCalendarUtc(endAt)}`,
    `SUMMARY:${title}`,
    "DESCRIPTION:Тренировка в Твой Бокс",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Напоминание за 1 день",
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Напоминание за 1 час",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Blob([content], { type: "text/calendar;charset=utf-8" });
}

export class MiniAppPreviewRuntime {
  isEnabled(): boolean {
    return isLocalPreviewEnvironment();
  }

  createSession(): SessionResponse {
    return this.devLogin({
      telegramId: PREVIEW_CLIENT_TELEGRAM_ID,
      username: "demo_client",
      firstName: "Демо",
      lastName: "Клиент",
    });
  }

  devLogin(payload: {
    telegramId: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }): SessionResponse {
    const role: MiniAppRole = payload.telegramId === PREVIEW_TRAINER_TELEGRAM_ID || payload.username === "demo_trainer"
      ? "trainer"
      : "client";
    const token = makePreviewToken({
      role,
      telegramId: payload.telegramId,
      username: payload.username ?? null,
      firstName: payload.firstName ?? (role === "trainer" ? "Демо" : "Демо"),
      lastName: payload.lastName ?? (role === "trainer" ? "Тренер" : "Клиент"),
    });

    return {
      status: "ok",
      token,
      session: getSessionFromToken(token),
    };
  }

  getMe(token: string): MiniAppMeResponse {
    return getMeResponse(readPreviewState(), token);
  }

  updateProfile(token: string, payload: {
    fullName: string;
    phone?: string | null;
    note?: string | null;
    consentAccepted?: boolean;
  }): UpdateProfileResponse {
    const session = getSessionFromToken(token);
    if (session.role !== "client") {
      throw new Error("Профиль клиента доступен только клиенту.");
    }

    const state = readPreviewState();
    state.clients = state.clients.map((item) => item.telegramId === session.telegramId
      ? {
          ...item,
          fullName: payload.fullName,
          phone: payload.phone ?? null,
          note: payload.note ?? null,
          consentAcceptedAt: payload.consentAccepted ? new Date().toISOString() : item.consentAcceptedAt,
        }
      : item);
    writePreviewState(state);

    return {
      status: "updated",
      profile: findClient(state, state.clients.find((item) => item.telegramId === session.telegramId)?.id ?? PREVIEW_CLIENT_ID),
    };
  }

  getClientSlots(): AvailableSlot[] {
    const state = readPreviewState();
    const now = new Date();
    const fromIso = new Date(now.getTime() - HOUR_MS).toISOString();
    const toIso = getPreviewHorizonEndIso(now, state.settings.bookingHorizonDays);
    return buildPreviewSlots(state, fromIso, toIso).filter((item) => item.status === "OPEN");
  }

  getClientClosureInfo(): SlotClosureInfo {
    return {
      hasClosure: false,
      reason: null,
      closedFrom: null,
      closedUntil: null,
      closedSlotsCount: 0,
    };
  }

  getClientBookingRules(): TrainerSettingsResponse {
    const state = readPreviewState();
    return {
      status: "ok",
      settings: clone(state.settings),
    };
  }

  getClientTrainings(token: string, params?: { includeArchived?: boolean }): { status: "ok"; items: ClientTrainingDto[] } {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const changed = autoArchivePastPreviewBookings(state);
    if (changed) {
      writePreviewState(state);
    }
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    if (!client) {
      return { status: "ok", items: [] };
    }

    const items = state.bookings
      .filter((item) => item.clientId === client.id && (params?.includeArchived ? item.archivedByClient : !item.archivedByClient))
      .sort((left, right) => params?.includeArchived ? right.startAt.localeCompare(left.startAt) : left.startAt.localeCompare(right.startAt))
      .map(buildClientTraining);

    return { status: "ok", items };
  }

  downloadClientCalendarFile(token: string, bookingId: string): Blob {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === client?.id);
    if (!booking) {
      throw new Error("Запись не найдена.");
    }

    return createCalendarBlob("Тренировка в Твой Бокс", booking.startAt, booking.endAt);
  }

  downloadTrainerBookingCalendarFile(token: string, bookingId: string): Blob {
    const session = getSessionFromToken(token);
    if (session.role !== "trainer") {
      throw new Error("Доступ разрешён только тренеру.");
    }

    const state = readPreviewState();
    const booking = state.bookings.find((item) => item.id === bookingId && !item.archivedByTrainer);
    if (!booking) {
      throw new Error("Заявка не найдена.");
    }

    if (["CANCELLED", "REJECTED", "EXPIRED"].includes(booking.status)) {
      throw new Error("Для этой заявки календарный файл недоступен.");
    }

    return createCalendarBlob("Твой Бокс — заявка на тренировку", booking.startAt, booking.endAt);
  }

  requestBooking(token: string, payload: { slotId: string; clientComment?: string | null }): CreateBookingResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    if (!client) {
      throw new Error("Профиль клиента не найден.");
    }

    const startAt = parseSlotId(payload.slotId);
    const available = this.getClientSlots().find((item) => item.id === payload.slotId);
    if (!available) {
      throw new Error("Слот сейчас недоступен.");
    }

    const booking: PreviewBookingRecord = {
      id: `preview-booking-${Date.now()}`,
      clientId: client.id,
      status: "PENDING",
      trainingStatus: null,
      startAt,
      endAt: available.endAt,
      createdAt: new Date().toISOString(),
      expiresAt: addMinutes(new Date().toISOString(), 30),
      clientComment: payload.clientComment ?? null,
      trainerComment: null,
      proposedStartAt: null,
      archivedByClient: false,
      archivedByTrainer: false,
    };

    state.bookings.push(booking);
    writePreviewState(state);

    return {
      status: "created",
      booking: {
        id: booking.id,
        slotId: payload.slotId,
        status: booking.status,
        expiresAt: booking.expiresAt,
        startAt: booking.startAt,
        endAt: booking.endAt,
      },
    };
  }

  cancelTraining(token: string, payload: { bookingId: string; clientComment?: string }): BookingActionResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId && item.clientId === client?.id
      ? {
          ...item,
          status: "CANCELLED",
          trainingStatus: item.trainingStatus ? "CANCELLED" : null,
          clientComment: payload.clientComment || item.clientComment,
        }
      : item);
    writePreviewState(state);

    return { status: "cancelled" };
  }

  rescheduleTraining(token: string, payload: {
    bookingId: string;
    targetSlotId: string;
    clientComment?: string;
  }): BookingActionResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    const targetStartAt = parseSlotId(payload.targetSlotId);
    const targetSlot = this.getClientSlots().find((item) => item.id === payload.targetSlotId);
    if (!targetSlot) {
      throw new Error("Новый слот сейчас недоступен.");
    }

    state.bookings = state.bookings.map((item) => item.id === payload.bookingId && item.clientId === client?.id
      ? {
          ...item,
          status: "RESCHEDULED",
          trainingStatus: item.trainingStatus ? "RESCHEDULED" : null,
          proposedStartAt: targetStartAt,
          trainerComment: "Клиент предложил перенос тренировки.",
          clientComment: payload.clientComment || item.clientComment,
        }
      : item);
    writePreviewState(state);

    return { status: "rescheduled" };
  }

  acceptProposal(token: string, payload: { bookingId: string }): BookingActionResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);

    state.bookings = state.bookings.map((item) => {
      if (item.id !== payload.bookingId || item.clientId !== client?.id || !item.proposedStartAt) {
        return item;
      }

      return {
        ...item,
        startAt: item.proposedStartAt,
        endAt: addMinutes(item.proposedStartAt, 60),
        status: "CONFIRMED",
        trainingStatus: "SCHEDULED",
        proposedStartAt: null,
      };
    });
    writePreviewState(state);

    return { status: "confirmed" };
  }

  declineProposal(token: string, payload: { bookingId: string }): BookingActionResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);

    state.bookings = state.bookings.map((item) => {
      if (item.id !== payload.bookingId || item.clientId !== client?.id) {
        return item;
      }

      return {
        ...item,
        proposedStartAt: null,
        status: item.trainingStatus ? "CONFIRMED" : "PENDING",
        trainingStatus: item.trainingStatus === "RESCHEDULED" ? "SCHEDULED" : item.trainingStatus,
      };
    });
    writePreviewState(state);

    return { status: "cancelled" };
  }

  archiveClientTraining(token: string, payload: { bookingId: string }): BookingActionResponse {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId && item.clientId === client?.id
      ? { ...item, archivedByClient: true }
      : item);
    writePreviewState(state);

    return { status: "archived" };
  }

  createNoSlotRequest(token: string, payload: {
    preferredDays: string[];
    preferredTime?: string | null;
    clientComment?: string | null;
  }): { status: "created" } {
    const session = getSessionFromToken(token);
    const state = readPreviewState();
    const client = state.clients.find((item) => item.telegramId === session.telegramId);
    if (!client) {
      throw new Error("Клиент не найден.");
    }

    state.noSlotRequests.unshift({
      id: `preview-no-slot-${Date.now()}`,
      clientId: client.id,
      status: "NEW",
      preferredDays: payload.preferredDays,
      preferredTime: payload.preferredTime ?? null,
      clientComment: payload.clientComment ?? null,
      trainerComment: null,
      createdAt: new Date().toISOString(),
    });
    writePreviewState(state);

    return { status: "created" };
  }

  getTrainerBookings(): { status: "ok"; items: PendingBookingDto[] } {
    const state = readPreviewState();
    const items = state.bookings
      .filter((item) => !item.archivedByTrainer && (item.status === "PENDING" || item.status === "RESCHEDULED"))
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map((item) => buildPendingBooking(state, item));

    return { status: "ok", items };
  }

  confirmTrainerBooking(payload: { bookingId: string }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? {
          ...item,
          status: "CONFIRMED",
          trainingStatus: "SCHEDULED",
          trainerComment: item.trainerComment || "Запись подтверждена.",
          proposedStartAt: null,
        }
      : item);
    writePreviewState(state);

    return { status: "confirmed" };
  }

  rejectTrainerBooking(payload: { bookingId: string; trainerComment: string }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? {
          ...item,
          status: "REJECTED",
          trainerComment: payload.trainerComment,
        }
      : item);
    writePreviewState(state);

    return { status: "rejected" };
  }

  proposeTrainerBookingTime(payload: {
    bookingId: string;
    proposedStartAt: string;
    trainerComment: string;
  }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? {
          ...item,
          status: "RESCHEDULED",
          trainingStatus: item.trainingStatus ? "RESCHEDULED" : null,
          proposedStartAt: payload.proposedStartAt,
          trainerComment: payload.trainerComment,
        }
      : item);
    writePreviewState(state);

    return { status: "proposed" };
  }

  getTrainerTrainings(params?: { from?: string; to?: string; includeArchived?: boolean }): { status: "ok"; items: TrainerTrainingDto[] } {
    const state = readPreviewState();
    const changed = autoArchivePastPreviewBookings(state);
    if (changed) {
      writePreviewState(state);
    }
    const from = params?.from ?? createMoscowIso("2026-05-22", "00:00");
    const to = params?.to ?? createMoscowIso("2026-06-05", "23:00");
    const items = state.bookings
      .filter((item) => (params?.includeArchived ? item.archivedByTrainer : !item.archivedByTrainer) && item.trainingStatus !== null && item.startAt >= from && item.startAt <= to)
      .sort((left, right) => params?.includeArchived ? right.startAt.localeCompare(left.startAt) : left.startAt.localeCompare(right.startAt))
      .map((item) => buildTrainerTraining(state, item));

    return { status: "ok", items };
  }

  cancelTrainerTraining(payload: { bookingId: string; trainerComment: string }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? {
          ...item,
          status: "CANCELLED",
          trainingStatus: "CANCELLED",
          trainerComment: payload.trainerComment,
        }
      : item);
    writePreviewState(state);

    return { status: "cancelled" };
  }

  rescheduleTrainerTraining(payload: {
    bookingId: string;
    newStartAt: string;
    trainerComment: string;
  }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? {
          ...item,
          status: "RESCHEDULED",
          trainingStatus: "RESCHEDULED",
          proposedStartAt: payload.newStartAt,
          trainerComment: payload.trainerComment,
        }
      : item);
    writePreviewState(state);

    return { status: "proposed" };
  }

  forceCloseTrainerBooking(payload: { bookingId: string }): BookingActionResponse {
    return this.archiveTrainerBooking(payload);
  }

  archiveTrainerBooking(payload: { bookingId: string }): BookingActionResponse {
    const state = readPreviewState();
    state.bookings = state.bookings.map((item) => item.id === payload.bookingId
      ? { ...item, archivedByTrainer: true }
      : item);
    writePreviewState(state);

    return { status: "archived" };
  }

  resyncTrainerCalendar(): BookingActionResponse {
    throw new Error("В локальном preview синхронизация с Google Calendar не выполняется. Её нужно проверять уже на живом backend.");
  }

  getTrainerSlots(params: { from: string; to: string }): AvailableSlot[] {
    return buildPreviewSlots(readPreviewState(), params.from, params.to);
  }

  openTrainerSlots(payload: { startAt: string; endAt?: string }): void {
    const state = readPreviewState();
    const from = payload.startAt;
    const to = payload.endAt ?? payload.startAt;
    state.manualClosedSlots = state.manualClosedSlots.filter((item) => item < from || item > to);
    writePreviewState(state);
  }

  closeTrainerSlots(payload: { slotId?: string; startAt?: string; endAt?: string }): void {
    const state = readPreviewState();
    const from = payload.slotId ? parseSlotId(payload.slotId) : payload.startAt;
    const to = payload.endAt ?? from;
    if (!from || !to) {
      return;
    }

    const slots = buildPreviewSlots(state, from, to)
      .map((item) => item.startAt)
      .filter((item) => item >= from && item <= to);

    const nextClosed = new Set(state.manualClosedSlots);
    for (const slot of slots) {
      nextClosed.add(slot);
    }
    state.manualClosedSlots = [...nextClosed];
    writePreviewState(state);
  }

  reopenTrainerSlots(payload: { startAt: string; endAt?: string }): void {
    this.openTrainerSlots(payload);
  }

  getTrainerSettings(): TrainerSettingsResponse {
    const state = readPreviewState();
    return {
      status: "ok",
      settings: clone(state.settings),
    };
  }

  updateTrainerSettings(payload: {
    bookingHorizonDays?: number;
    sameDayBookingCutoff?: number;
    workingDays?: string[];
    workdayStartHour?: number;
    workdayEndHour?: number;
  }): TrainerSettingsResponse {
    const state = readPreviewState();
    state.settings = {
      ...state.settings,
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    writePreviewState(state);

    return {
      status: "updated",
      settings: clone(state.settings),
    };
  }

  searchTrainerClients(query: string, limit = 10): ClientsResponse {
    const state = readPreviewState();
    const normalized = query.trim().toLowerCase();
    const items = state.clients
      .filter((item) => [item.fullName, item.phone ?? "", item.username ?? ""].some((field) => field.toLowerCase().includes(normalized)))
      .slice(0, limit);

    return { status: "ok", items };
  }

  getTrainerBlacklist(): ClientsResponse {
    const state = readPreviewState();
    return {
      status: "ok",
      items: state.clients.filter((item) => item.isBlacklisted),
    };
  }

  addTrainerBlacklist(payload: { clientId: string; reason: string }): { status: "added" | "already_blacklisted"; client: ClientProfile } {
    const state = readPreviewState();
    let updatedClient = findClient(state, payload.clientId);
    const alreadyBlacklisted = updatedClient.isBlacklisted;
    state.clients = state.clients.map((item) => item.id === payload.clientId
      ? {
          ...item,
          isBlacklisted: true,
          blacklistReason: payload.reason,
          blacklistedAt: new Date().toISOString(),
        }
      : item);
    updatedClient = findClient(state, payload.clientId);
    writePreviewState(state);

    return {
      status: alreadyBlacklisted ? "already_blacklisted" : "added",
      client: updatedClient,
    };
  }

  removeTrainerBlacklist(payload: { clientId: string }): { status: "removed" | "already_removed"; client: ClientProfile } {
    const state = readPreviewState();
    let updatedClient = findClient(state, payload.clientId);
    const alreadyRemoved = !updatedClient.isBlacklisted;
    state.clients = state.clients.map((item) => item.id === payload.clientId
      ? {
          ...item,
          isBlacklisted: false,
          blacklistReason: null,
          blacklistedAt: null,
        }
      : item);
    updatedClient = findClient(state, payload.clientId);
    writePreviewState(state);

    return {
      status: alreadyRemoved ? "already_removed" : "removed",
      client: updatedClient,
    };
  }

  getTrainerNoSlotRequests(status?: NoSlotRequestStatusType): NoSlotRequestsResponse {
    const state = readPreviewState();
    const items = state.noSlotRequests
      .filter((item) => !status || item.status === status)
      .map((item) => buildNoSlotRequest(state, item));

    return { status: "ok", items };
  }

  updateTrainerNoSlotRequest(payload: {
    requestId: string;
    status: NoSlotRequestStatusType;
    trainerComment?: string | null;
  }): { status: "updated"; request: NoSlotRequestDto } {
    const state = readPreviewState();
    state.noSlotRequests = state.noSlotRequests.map((item) => item.id === payload.requestId
      ? {
          ...item,
          status: payload.status,
          trainerComment: payload.trainerComment ?? item.trainerComment,
        }
      : item);
    writePreviewState(state);

    const request = state.noSlotRequests.find((item) => item.id === payload.requestId);
    if (!request) {
      throw new Error("Запрос не найден.");
    }

    return {
      status: "updated",
      request: buildNoSlotRequest(state, request),
    };
  }

  exportTrainerData(): Blob {
    const state = readPreviewState();
    const header = "client,telegramId,status,startAt,endAt\n";
    const rows = state.bookings.map((item) => {
      const client = findClient(state, item.clientId);
      return [client.fullName, client.telegramId, item.status, item.startAt, item.endAt].join(",");
    });

    return new Blob([header, ...rows.map((row) => `${row}\n`)], { type: "text/csv;charset=utf-8" });
  }
}
