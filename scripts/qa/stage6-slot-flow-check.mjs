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

async function main() {
  const rootDir = resolve(process.cwd());
  const envPath = resolve(rootDir, ".env");
  const envFile = await loadEnvFromFile(envPath);

  const apiBaseUrl = (process.env.API_BASE_URL || envFile.API_BASE_URL || "http://localhost:3000").replace(/\/$/u, "");
  const trainerTelegramId = process.env.TRAINER_TELEGRAM_ID || envFile.TRAINER_TELEGRAM_ID;
  const testTelegramId = process.env.STAGE6_TEST_TELEGRAM_ID || "900000000001";

  if (!trainerTelegramId) {
    throw new Error("TRAINER_TELEGRAM_ID is required in .env for this check");
  }

  const startAt = addHours(toFullHourUtc(new Date()), 48);
  const endAt = addHours(startAt, 2);

  await requestJson(`${apiBaseUrl}/clients/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId: testTelegramId,
      username: "stage6-check",
      fullName: "Stage 6 Runtime Check",
      phone: null,
      consentAccepted: true,
    }),
  });

  const openResult = await requestJson(`${apiBaseUrl}/slots/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    }),
  });

  const beforeClose = await requestJson(
    `${apiBaseUrl}/slots/available?telegramId=${encodeURIComponent(testTelegramId)}`,
    { method: "GET" },
  );

  const inRangeBeforeClose = (beforeClose || []).filter((slot) => {
    const slotStart = new Date(slot.startAt).getTime();
    return slotStart >= startAt.getTime() && slotStart < endAt.getTime();
  });

  if (inRangeBeforeClose.length === 0) {
    throw new Error("No opened test slots are visible in /slots/available");
  }

  const slotToClose = inRangeBeforeClose[0];

  await requestJson(`${apiBaseUrl}/slots/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      slotId: slotToClose.id,
      reason: "stage6-runtime-check",
    }),
  });

  const afterClose = await requestJson(
    `${apiBaseUrl}/slots/available?telegramId=${encodeURIComponent(testTelegramId)}`,
    { method: "GET" },
  );

  const stillVisible = (afterClose || []).some((slot) => slot.id === slotToClose.id);
  if (stillVisible) {
    throw new Error("Closed slot is still visible in /slots/available");
  }

  const remainingInRange = (afterClose || []).filter((slot) => {
    const slotStart = new Date(slot.startAt).getTime();
    return slotStart >= startAt.getTime() && slotStart < endAt.getTime();
  });

  await requestJson(`${apiBaseUrl}/slots/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trainerTelegramId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reason: "stage6-runtime-check-cleanup",
    }),
  });

  console.log("Stage 6 slot flow check: OK");
  console.log(`API base URL: ${apiBaseUrl}`);
  console.log(`Test client: ${testTelegramId}`);
  console.log(`Open result: ${JSON.stringify(openResult)}`);
  console.log(`Slots in range before close: ${inRangeBeforeClose.length}`);
  console.log(`Slots in range after close: ${remainingInRange.length}`);
}

main().catch((error) => {
  const normalizedError = error;
  console.error("Stage 6 slot flow check: FAILED");
  console.error(normalizedError instanceof Error ? normalizedError.message : String(normalizedError));
  process.exitCode = 1;
});
