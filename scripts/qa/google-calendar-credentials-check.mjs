import { createPrivateKey, createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

function buildUnsignedJwt(serviceEmail) {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + 3600;

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: serviceEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${encodedHeader}.${encodedPayload}`;
}

function normalizePrivateKey(rawValue) {
  return rawValue.replaceAll("\\n", "\n").trim();
}

async function loadCredentials(env, envPath) {
  const jsonPathValue = (env.GOOGLE_SERVICE_ACCOUNT_JSON_SOURCE || env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || "").trim();
  if (jsonPathValue) {
    const envDir = dirname(envPath);
    const candidates = [
      resolve(envDir, jsonPathValue),
      resolve(envDir, "deploy", jsonPathValue),
    ];

    let rawJson = null;
    let resolvedPath = "";
    let lastError = null;
    for (const candidate of candidates) {
      try {
        rawJson = await readFile(candidate, "utf8");
        resolvedPath = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (rawJson === null) {
      throw lastError;
    }

    const payload = JSON.parse(rawJson);
    return {
      source: `json:${resolvedPath}`,
      serviceEmail: (payload.client_email || "").trim(),
      privateKey: ((payload.private_key || "") + "").replaceAll("\\n", "\n").trim(),
    };
  }

  return {
    source: "env",
    serviceEmail: (env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim(),
    privateKey: normalizePrivateKey(env.GOOGLE_PRIVATE_KEY || ""),
  };
}

async function main() {
  const envArg = process.argv[2] || ".env.server";
  const envPath = resolve(process.cwd(), envArg);
  const env = parseEnv(await readFile(envPath, "utf8"));

  const syncMode = (env.GOOGLE_CALENDAR_SYNC_MODE || "").trim() || "real";
  const calendarId = (env.GOOGLE_CALENDAR_ID || "").trim() || "primary";
  const credentials = await loadCredentials(env, envPath);
  const serviceEmail = credentials.serviceEmail;
  const privateKey = credentials.privateKey;

  console.log(`Проверка Google Calendar credentials из: ${envPath}`);
  console.log(`Режим синхронизации: ${syncMode}`);
  console.log(`Источник credentials: ${credentials.source}`);
  console.log(`Service account: ${serviceEmail || "(не задан)"}`);
  console.log(`Calendar ID: ${calendarId}`);

  if (syncMode === "mock") {
    console.log("Синхронизация уже в mock-режиме. Валидность ключа сейчас не критична.");
    return;
  }

  if (!serviceEmail) {
    throw new Error("Не задан GOOGLE_SERVICE_ACCOUNT_EMAIL.");
  }

  if (!privateKey) {
    throw new Error("Не найден private key ни в JSON-файле, ни в GOOGLE_PRIVATE_KEY.");
  }
  const keyObject = createPrivateKey({
    key: privateKey,
    format: "pem",
  });

  const signer = createSign("RSA-SHA256");
  signer.update(buildUnsignedJwt(serviceEmail));
  signer.end();
  const signature = signer.sign(keyObject, "base64url");

  console.log("Ключ успешно распознан и может подписывать JWT.");
  console.log(`Тип ключа: ${keyObject.asymmetricKeyType || "unknown"}`);
  console.log(`Длина подписи: ${signature.length}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Проверка Google Calendar credentials: FAILED");
  console.error(message);
  process.exitCode = 1;
});
