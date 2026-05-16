import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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

async function requestJson(url, options) {
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

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text}`);
  }

  return data;
}

function toFullHourUtc(date) {
  const result = new Date(date);
  result.setUTCMinutes(0, 0, 0);
  return result;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

async function ensureClient(apiBaseUrl, telegramId) {
  await requestJson(`${apiBaseUrl}/clients/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      username: "stage8-check",
      fullName: "Stage 8 Runtime Check",
      phone: null,
      consentAccepted: true,
    }),
  });
}

async function openSlot(apiBaseUrl, trainerTelegramId, startAt) {
  const endAt = addHours(startAt, 1);
  await requestJson(`${apiBaseUrl}/slots/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    }),
  });
}

async function findAvailableSlot(apiBaseUrl, telegramId, expectedStartAt) {
  const available = await requestJson(
    `${apiBaseUrl}/slots/available?telegramId=${encodeURIComponent(telegramId)}`,
    { method: "GET" },
  );

  return (available || []).find((slot) => slot.startAt === expectedStartAt.toISOString()) ?? null;
}

async function createBooking(apiBaseUrl, telegramId, slotId) {
  return requestJson(`${apiBaseUrl}/bookings/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId,
      slotId,
    }),
  });
}

async function main() {
  const rootDir = resolve(process.cwd());
  const envPath = resolve(rootDir, ".env");
  const envFile = await loadEnvFromFile(envPath);

  const apiBaseUrl = (process.env.API_BASE_URL || envFile.API_BASE_URL || "http://localhost:3000").replace(/\/$/u, "");
  const trainerTelegramId = process.env.TRAINER_TELEGRAM_ID || envFile.TRAINER_TELEGRAM_ID;
  const testTelegramId = process.env.STAGE8_TEST_TELEGRAM_ID || "900000000002";

  if (!trainerTelegramId) {
    throw new Error("TRAINER_TELEGRAM_ID is required in .env for this check");
  }

  await ensureClient(apiBaseUrl, testTelegramId);

  const base = toFullHourUtc(new Date());
  const slotConfirmStart = addHours(base, 48);
  const slotRejectStart = addHours(base, 72);
  const slotProposeStart = addHours(base, 96);
  const proposedStart = addHours(base, 120);

  await openSlot(apiBaseUrl, trainerTelegramId, slotConfirmStart);
  await openSlot(apiBaseUrl, trainerTelegramId, slotRejectStart);
  await openSlot(apiBaseUrl, trainerTelegramId, slotProposeStart);

  const confirmSlot = await findAvailableSlot(apiBaseUrl, testTelegramId, slotConfirmStart);
  const rejectSlot = await findAvailableSlot(apiBaseUrl, testTelegramId, slotRejectStart);
  const proposeSlot = await findAvailableSlot(apiBaseUrl, testTelegramId, slotProposeStart);

  if (!confirmSlot || !rejectSlot || !proposeSlot) {
    throw new Error("Не удалось найти подготовленные слоты в /slots/available");
  }

  const confirmBooking = await createBooking(apiBaseUrl, testTelegramId, confirmSlot.id);
  const rejectBooking = await createBooking(apiBaseUrl, testTelegramId, rejectSlot.id);
  const proposeBooking = await createBooking(apiBaseUrl, testTelegramId, proposeSlot.id);

  const pendingBefore = await requestJson(
    `${apiBaseUrl}/bookings/pending?trainerTelegramId=${encodeURIComponent(trainerTelegramId)}`,
    { method: "GET" },
  );

  const pendingIds = new Set((pendingBefore.items || []).map((item) => item.id));
  if (!pendingIds.has(confirmBooking.booking.id) || !pendingIds.has(rejectBooking.booking.id) || !pendingIds.has(proposeBooking.booking.id)) {
    throw new Error("Не все тестовые заявки появились в списке /bookings/pending");
  }

  const confirmResult = await requestJson(`${apiBaseUrl}/bookings/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      bookingId: confirmBooking.booking.id,
    }),
  });

  if (confirmResult.status !== "confirmed" || confirmResult.booking.status !== "CONFIRMED") {
    throw new Error("Подтверждение заявки вернуло неожиданный статус");
  }

  const rejectResult = await requestJson(`${apiBaseUrl}/bookings/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      bookingId: rejectBooking.booking.id,
      trainerComment: "stage8-runtime-check reject",
    }),
  });

  if (rejectResult.status !== "rejected" || rejectResult.booking.status !== "REJECTED") {
    throw new Error("Отклонение заявки вернуло неожиданный статус");
  }

  const proposeResult = await requestJson(`${apiBaseUrl}/bookings/propose-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      bookingId: proposeBooking.booking.id,
      proposedStartAt: proposedStart.toISOString(),
      trainerComment: "stage8-runtime-check propose",
    }),
  });

  if (proposeResult.status !== "proposed" || proposeResult.booking.status !== "RESCHEDULED") {
    throw new Error("Предложение другого времени вернуло неожиданный статус");
  }

  const availableAfter = await requestJson(
    `${apiBaseUrl}/slots/available?telegramId=${encodeURIComponent(testTelegramId)}`,
    { method: "GET" },
  );

  const rejectedSlotReturned = (availableAfter || []).some((slot) => slot.startAt === slotRejectStart.toISOString());
  const proposedSlotReturned = (availableAfter || []).some((slot) => slot.startAt === slotProposeStart.toISOString());

  if (!rejectedSlotReturned || !proposedSlotReturned) {
    throw new Error("После reject/propose слоты должны снова быть доступны");
  }

  console.log("Stage 8 admin booking flow check: OK");
  console.log(`API base URL: ${apiBaseUrl}`);
  console.log(`Test client: ${testTelegramId}`);
  console.log(`Confirmed booking: ${confirmBooking.booking.id}`);
  console.log(`Rejected booking: ${rejectBooking.booking.id}`);
  console.log(`Proposed booking: ${proposeBooking.booking.id}`);
}

main().catch((error) => {
  const normalizedError = error;
  console.error("Stage 8 admin booking flow check: FAILED");
  console.error(normalizedError instanceof Error ? normalizedError.message : String(normalizedError));
  process.exitCode = 1;
});
