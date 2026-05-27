import { createHmac } from "node:crypto";
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

async function getTelegramBotProfile(telegramBotToken) {
  const response = await requestJson(`https://api.telegram.org/bot${telegramBotToken}/getMe`, {
    method: "GET",
  });

  return response.result;
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

function getRequiredConfig(...candidates) {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function buildTelegramInitData(telegramBotToken, user, authDate) {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", `stage28-${user.id}`);
  params.set("user", JSON.stringify(user));

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(telegramBotToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  params.set("hash", hash);
  return params.toString();
}

async function createSession(apiBaseUrl, initData) {
  return requestJson(`${apiBaseUrl}/mini-app/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

async function authGet(apiBaseUrl, path, token) {
  return requestJson(`${apiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function authPost(apiBaseUrl, path, token, body) {
  return requestJson(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function pickAvailableSlot(items) {
  return (items || [])[0] ?? null;
}

function findClientTraining(items, bookingId) {
  return (items || []).find((item) => item.bookingId === bookingId || item.id === bookingId) ?? null;
}

function findTrainerBooking(items, bookingId) {
  return (items || []).find((item) => item.id === bookingId || item.bookingId === bookingId) ?? null;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const rootDir = resolve(process.cwd());
  const envPath = resolve(rootDir, ".env");
  const envFile = await loadEnvFromFile(envPath);

  const apiBaseUrl = getRequiredConfig(
    process.env.API_BASE_URL,
    envFile.API_BASE_URL,
    "http://localhost:3000",
  ).replace(/\/$/u, "");
  const telegramBotToken = getRequiredConfig(
    process.env.STAGE28_MINI_APP_BOT_TOKEN,
    process.env.TELEGRAM_BOT_TOKEN,
    envFile.TELEGRAM_BOT_TOKEN,
  );
  const trainerTelegramId = normalizeTelegramId(
    process.env.TRAINER_TELEGRAM_ID,
    envFile.TRAINER_TELEGRAM_ID,
    process.env.ADMIN_TELEGRAM_ID,
    envFile.ADMIN_TELEGRAM_ID,
  );
  const clientTelegramId = getRequiredConfig(
    process.env.STAGE28_INITDATA_CLIENT_TELEGRAM_ID,
    "900000000044",
  );

  assert(telegramBotToken, "TELEGRAM_BOT_TOKEN (or STAGE28_MINI_APP_BOT_TOKEN) is required");
  assert(trainerTelegramId, "TRAINER_TELEGRAM_ID or ADMIN_TELEGRAM_ID is required");

  const botProfile = await getTelegramBotProfile(telegramBotToken);
  const normalizedApiBaseUrl = apiBaseUrl.toLowerCase();
  if (
    normalizedApiBaseUrl === "https://app.anyatobolova.ru/mini-api"
    && String(botProfile.username || "").trim().toLowerCase() === "tvoybox_bot"
  ) {
    throw new Error("External dev initData check requires the dedicated test bot token, not production @TvoyBox_bot");
  }

  const authDate = Math.floor(Date.now() / 1000);
  const clientUser = {
    id: Number(clientTelegramId),
    username: "stage28_initdata_client",
    first_name: "Stage28",
    last_name: "InitData",
  };
  const trainerUser = {
    id: Number(trainerTelegramId),
    username: "stage28_initdata_trainer",
    first_name: "Stage28",
    last_name: "Trainer",
  };

  assert(Number.isSafeInteger(clientUser.id), "Client telegram id must be numeric for initData");
  assert(Number.isSafeInteger(trainerUser.id), "Trainer telegram id must be numeric for initData");

  const clientSession = await createSession(
    apiBaseUrl,
    buildTelegramInitData(telegramBotToken, clientUser, authDate),
  );
  const trainerSession = await createSession(
    apiBaseUrl,
    buildTelegramInitData(telegramBotToken, trainerUser, authDate),
  );

  assert(clientSession.status === "ok", "Client session did not return ok");
  assert(trainerSession.status === "ok", "Trainer session did not return ok");
  assert(clientSession.session?.role === "client", "Client session role mismatch");
  assert(trainerSession.session?.role === "trainer", "Trainer session role mismatch");

  const clientMeBefore = await authGet(apiBaseUrl, "/mini-app/me", clientSession.token);
  assert(clientMeBefore.status === "ok", "Client /me did not return ok");
  assert(clientMeBefore.supportContact?.telegramUrl === "https://t.me/RostPV", "Unexpected support contact link");

  await authPost(apiBaseUrl, "/mini-app/me", clientSession.token, {
    fullName: "Stage 28 InitData Client",
    phone: null,
    note: "stage28-initdata-flow",
    consentAccepted: true,
  });

  const clientMeAfter = await authGet(apiBaseUrl, "/mini-app/me", clientSession.token);
  assert(clientMeAfter.needsProfileCompletion === false, "Client profile was not completed through mini app auth flow");
  assert(clientMeAfter.profile?.telegramId === String(clientUser.id), "Client profile telegramId mismatch");

  const availableSlots = await authGet(apiBaseUrl, "/mini-app/client/slots", clientSession.token);
  const initialSlot = pickAvailableSlot(availableSlots);
  assert(initialSlot?.id, "No available slot found for initData flow check");

  const bookingRequest = await authPost(apiBaseUrl, "/mini-app/client/bookings/request", clientSession.token, {
    slotId: initialSlot.id,
    clientComment: "stage28-initdata-flow",
  });
  const bookingId = bookingRequest.booking?.id;
  assert(bookingRequest.status === "created", "Client booking request did not return created");
  assert(bookingId, "Client booking request did not return booking id");

  const clientTrainingsAfterRequest = await authGet(apiBaseUrl, "/mini-app/client/trainings", clientSession.token);
  const pendingClientTraining = findClientTraining(clientTrainingsAfterRequest.items, bookingId);
  assert(pendingClientTraining, "Client training list does not contain the created booking");
  assert(pendingClientTraining.bookingStatus === "PENDING", "Client booking is not pending after request");

  const trainerMe = await authGet(apiBaseUrl, "/mini-app/me", trainerSession.token);
  assert(trainerMe.session?.role === "trainer", "Trainer /me did not keep trainer role");

  const trainerPendingBookings = await authGet(apiBaseUrl, "/mini-app/trainer/bookings", trainerSession.token);
  const pendingTrainerBooking = findTrainerBooking(trainerPendingBookings.items, bookingId);
  assert(pendingTrainerBooking, "Trainer pending bookings do not contain the client request");
  assert(pendingTrainerBooking.status === "PENDING", "Trainer sees non-pending status for fresh booking");

  const confirmResult = await authPost(apiBaseUrl, "/mini-app/trainer/bookings/confirm", trainerSession.token, {
    bookingId,
  });
  assert(confirmResult.status === "confirmed", "Trainer confirm did not return confirmed");

  const clientTrainingsAfterConfirm = await authGet(apiBaseUrl, "/mini-app/client/trainings", clientSession.token);
  const confirmedClientTraining = findClientTraining(clientTrainingsAfterConfirm.items, bookingId);
  assert(confirmedClientTraining, "Client trainings do not contain the confirmed booking");
  assert(confirmedClientTraining.bookingStatus === "CONFIRMED", "Client did not receive confirmed status after trainer action");

  const trainerTrainings = await authGet(apiBaseUrl, "/mini-app/trainer/trainings", trainerSession.token);
  const confirmedTrainerTraining = findTrainerBooking(trainerTrainings.items, bookingId);
  assert(confirmedTrainerTraining, "Trainer trainings do not contain the confirmed booking");
  assert(confirmedTrainerTraining.bookingStatus === "CONFIRMED", "Trainer trainings do not show confirmed booking status");

  console.log("stage28 telegram initData flow check: ok");
  console.log(`apiBaseUrl=${apiBaseUrl}`);
  console.log(`botId=${botProfile.id}`);
  console.log(`botUsername=${botProfile.username}`);
  console.log(`clientTelegramId=${clientUser.id}`);
  console.log(`trainerTelegramId=${trainerUser.id}`);
  console.log(`bookingId=${bookingId}`);
  console.log(`slotStartAt=${initialSlot.startAt}`);
}

await main();
