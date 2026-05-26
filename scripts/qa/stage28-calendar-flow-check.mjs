import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PLACEHOLDER_TELEGRAM_IDS = new Set([
  "123456789",
  "PUT_TRAINER_TELEGRAM_ID_HERE",
  "PUT_ADMIN_TELEGRAM_ID_HERE",
]);

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

async function loadEnvFromFile(envPath) {
  const envContent = await readFile(envPath, "utf8");
  return parseEnv(envContent);
}

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    text,
    data,
  };
}

async function requestJson(url, options) {
  const result = await request(url, options);
  if (!result.ok) {
    throw new Error(`HTTP ${result.status} for ${url}: ${result.text}`);
  }

  return result.data;
}

function normalizeTelegramId(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value || PLACEHOLDER_TELEGRAM_IDS.has(value)) {
      continue;
    }

    return value;
  }

  return "";
}

async function ensureClient(apiBaseUrl, telegramId, label) {
  await requestJson(`${apiBaseUrl}/clients/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      username: label,
      fullName: `Stage 28 ${label}`,
      phone: null,
      consentAccepted: true,
    }),
  });
}

async function createMiniAppDevSession(apiBaseUrl, telegramId, username, firstName) {
  const response = await requestJson(`${apiBaseUrl}/mini-app/session/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      username,
      firstName,
      lastName: "Stage28",
    }),
  });

  return response.token;
}

async function listAvailableSlots(apiBaseUrl, telegramId) {
  return requestJson(
    `${apiBaseUrl}/slots/available?telegramId=${encodeURIComponent(telegramId)}`,
    { method: "GET" },
  );
}

async function requestBooking(apiBaseUrl, telegramId, slotId) {
  return requestJson(`${apiBaseUrl}/bookings/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      slotId,
    }),
  });
}

async function confirmBooking(apiBaseUrl, trainerTelegramId, bookingId) {
  return requestJson(`${apiBaseUrl}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      bookingId,
    }),
  });
}

async function rescheduleTrainingByClient(apiBaseUrl, telegramId, bookingId, targetSlotId) {
  return requestJson(`${apiBaseUrl}/bookings/client/reschedule-training`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      bookingId,
      targetSlotId,
      clientComment: "stage28-calendar-flow",
    }),
  });
}

async function cancelTraining(apiBaseUrl, trainerTelegramId, bookingId) {
  return requestJson(`${apiBaseUrl}/bookings/cancel-training`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      bookingId,
      trainerComment: "stage28-calendar-flow cleanup",
    }),
  });
}

async function downloadClientCalendar(apiBaseUrl, clientToken, bookingId) {
  return request(`${apiBaseUrl}/mini-app/client/trainings/calendar?bookingId=${encodeURIComponent(bookingId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${clientToken}`,
    },
  });
}

function pickInitialSlot(availableSlots) {
  return (availableSlots || [])[0] ?? null;
}

function pickRescheduleSlot(availableSlots, initialSlot) {
  return (availableSlots || []).find((slot) => slot.id !== initialSlot.id && slot.startAt !== initialSlot.startAt) ?? null;
}

function assertIcsContent(label, text, expectedStartAt) {
  if (!text.includes("BEGIN:VCALENDAR") || !text.includes("BEGIN:VEVENT") || !text.includes("END:VCALENDAR")) {
    throw new Error(`${label}: ответ не похож на .ics`);
  }

  const expectedUtcStart = expectedStartAt.toISOString().replace(/[-:]/g, "").replace(".000Z", "Z");
  if (!text.includes(`DTSTART:${expectedUtcStart}`)) {
    throw new Error(`${label}: DTSTART не совпал с ожидаемым временем ${expectedUtcStart}`);
  }

  const alarmCount = (text.match(/BEGIN:VALARM/g) || []).length;
  if (alarmCount !== 2) {
    throw new Error(`${label}: ожидались 2 напоминания в .ics, получено ${alarmCount}`);
  }
}

async function main() {
  const rootDir = resolve(process.cwd());
  const envPath = resolve(rootDir, ".env");
  const envFile = await loadEnvFromFile(envPath);

  const apiBaseUrl = (process.env.API_BASE_URL || envFile.API_BASE_URL || "http://localhost:3000").replace(/\/$/u, "");
  const trainerTelegramId = normalizeTelegramId(
    process.env.TRAINER_TELEGRAM_ID,
    envFile.TRAINER_TELEGRAM_ID,
    process.env.ADMIN_TELEGRAM_ID,
    envFile.ADMIN_TELEGRAM_ID,
  );
  const clientTelegramId = process.env.STAGE28_CALENDAR_CLIENT_TELEGRAM_ID || "900000000033";
  const clientUsername = "stage28-calendar-client";

  if (!trainerTelegramId) {
    throw new Error("TRAINER_TELEGRAM_ID или ADMIN_TELEGRAM_ID обязателен для этой проверки");
  }

  await ensureClient(apiBaseUrl, clientTelegramId, clientUsername);
  const clientToken = await createMiniAppDevSession(apiBaseUrl, clientTelegramId, clientUsername, "Stage28Calendar");

  const initialSlot = pickInitialSlot(await listAvailableSlots(apiBaseUrl, clientTelegramId));
  if (!initialSlot) {
    throw new Error("Не найден исходный available slot для календарной проверки");
  }

  const bookingRequest = await requestBooking(apiBaseUrl, clientTelegramId, initialSlot.id);
  const bookingId = bookingRequest.booking?.id;
  if (!bookingId) {
    throw new Error("После request bookingId не вернулся");
  }

  const confirmResult = await confirmBooking(apiBaseUrl, trainerTelegramId, bookingId);
  if (confirmResult.status !== "confirmed" || confirmResult.booking.status !== "CONFIRMED") {
    throw new Error("Подтверждение заявки вернуло неожиданный статус");
  }

  const initialCalendar = await downloadClientCalendar(apiBaseUrl, clientToken, bookingId);
  if (!initialCalendar.ok) {
    throw new Error(`Не удалось скачать клиентский .ics после confirm: HTTP ${initialCalendar.status} ${initialCalendar.text}`);
  }

  assertIcsContent("confirm .ics", initialCalendar.text, new Date(initialSlot.startAt));

  const rescheduleSlot = pickRescheduleSlot(await listAvailableSlots(apiBaseUrl, clientTelegramId), initialSlot);
  if (!rescheduleSlot) {
    throw new Error("Не найден target slot для client reschedule");
  }

  const rescheduleRequest = await rescheduleTrainingByClient(apiBaseUrl, clientTelegramId, bookingId, rescheduleSlot.id);
  if (rescheduleRequest.status !== "rescheduled" || rescheduleRequest.booking.status !== "RESCHEDULED") {
    throw new Error("Client reschedule вернул неожиданный статус");
  }

  const confirmRescheduleResult = await confirmBooking(apiBaseUrl, trainerTelegramId, bookingId);
  if (confirmRescheduleResult.status !== "confirmed" || confirmRescheduleResult.booking.status !== "CONFIRMED") {
    throw new Error("Подтверждение client reschedule вернуло неожиданный статус");
  }

  const rescheduledCalendar = await downloadClientCalendar(apiBaseUrl, clientToken, bookingId);
  if (!rescheduledCalendar.ok) {
    throw new Error(`Не удалось скачать клиентский .ics после reschedule confirm: HTTP ${rescheduledCalendar.status} ${rescheduledCalendar.text}`);
  }

  assertIcsContent("reschedule .ics", rescheduledCalendar.text, new Date(rescheduleSlot.startAt));

  const cancelResult = await cancelTraining(apiBaseUrl, trainerTelegramId, bookingId);
  if (cancelResult.status !== "cancelled" || cancelResult.booking.status !== "CANCELLED") {
    throw new Error("Отмена тренировки вернула неожиданный статус");
  }

  const calendarAfterCancel = await downloadClientCalendar(apiBaseUrl, clientToken, bookingId);
  if (calendarAfterCancel.ok) {
    throw new Error("После cancel клиентский .ics неожиданно остался доступен");
  }

  if (calendarAfterCancel.status !== 409 || !calendarAfterCancel.text.includes("Cancelled training cannot be exported to calendar")) {
    throw new Error(`После cancel получен неожиданный ответ на .ics: HTTP ${calendarAfterCancel.status} ${calendarAfterCancel.text}`);
  }

  console.log("Stage 28 calendar flow check: OK");
  console.log(`API base URL: ${apiBaseUrl}`);
  console.log(`Trainer: ${trainerTelegramId}`);
  console.log(`Client: ${clientTelegramId}`);
  console.log(`Booking: ${bookingId}`);
  console.log(`Initial slot: ${initialSlot.startAt}`);
  console.log(`Reschedule slot: ${rescheduleSlot.startAt}`);
}

main().catch((error) => {
  const normalizedError = error;
  console.error("Stage 28 calendar flow check: FAILED");
  console.error(normalizedError instanceof Error ? normalizedError.message : String(normalizedError));
  process.exitCode = 1;
});
