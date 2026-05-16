import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createSign } from "node:crypto";

import { createRuntimeLogger } from "../../common/logging/runtime-logger";
import { AppConfigService } from "../../config/app-config.service";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const CALENDAR_TIMEZONE = "Europe/Moscow";

interface GoogleAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface GoogleCalendarEventResponse {
  id?: string;
  htmlLink?: string;
}

interface CreateOrUpdateEventInput {
  trainingId: string;
  clientName: string;
  clientPhone: string | null;
  clientUsername: string | null;
  clientTelegramId: string;
  startAt: Date;
  endAt: Date;
  trainerComment?: string | null;
}

interface CancelEventInput {
  trainingId: string;
  eventId: string;
}

interface CalendarApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
}

export interface CalendarSyncResult {
  eventId: string;
  htmlLink: string | null;
  mode: "real" | "mock";
}

export interface CancelSyncResult {
  mode: "real" | "mock";
  alreadyDeleted?: boolean;
}

@Injectable()
export class GoogleCalendarService {
  private readonly logger = createRuntimeLogger({
    scope: "google-calendar-sync",
    filePath: "../../logs/api/runtime.jsonl",
    minLevel: "debug",
  });

  private cachedAccessToken: { value: string; expiresAtMs: number } | null = null;

  constructor(private readonly appConfigService: AppConfigService) {}

  async createEvent(input: CreateOrUpdateEventInput): Promise<CalendarSyncResult> {
    if (this.getSyncMode() === "mock") {
      return {
        eventId: `mock-${input.trainingId}`,
        htmlLink: null,
        mode: "mock",
      };
    }

    const response = await this.requestCalendar<GoogleCalendarEventResponse>({
      method: "POST",
      path: `/calendars/${encodeURIComponent(this.appConfigService.values.googleCalendarId)}/events`,
      body: this.buildCalendarEventBody(input),
      operation: "create",
      trainingId: input.trainingId,
    });

    if (!response.id) {
      throw new ServiceUnavailableException("Google Calendar did not return created event id");
    }

    return {
      eventId: response.id,
      htmlLink: response.htmlLink ?? null,
      mode: "real",
    };
  }

  async updateEvent(eventId: string, input: CreateOrUpdateEventInput): Promise<CalendarSyncResult> {
    if (this.getSyncMode() === "mock") {
      return {
        eventId: eventId || `mock-${input.trainingId}`,
        htmlLink: null,
        mode: "mock",
      };
    }

    const normalizedEventId = eventId.trim();
    if (!normalizedEventId) {
      throw new ServiceUnavailableException("calendarEventId is missing");
    }

    const response = await this.requestCalendar<GoogleCalendarEventResponse>({
      method: "PUT",
      path: `/calendars/${encodeURIComponent(this.appConfigService.values.googleCalendarId)}/events/${encodeURIComponent(normalizedEventId)}`,
      body: this.buildCalendarEventBody(input),
      operation: "update",
      trainingId: input.trainingId,
    });

    return {
      eventId: response.id?.trim() || normalizedEventId,
      htmlLink: response.htmlLink ?? null,
      mode: "real",
    };
  }

  async cancelEvent(input: CancelEventInput): Promise<CancelSyncResult> {
    if (this.getSyncMode() === "mock") {
      return { mode: "mock" };
    }

    const normalizedEventId = input.eventId.trim();
    if (!normalizedEventId) {
      throw new ServiceUnavailableException("calendarEventId is missing");
    }

    try {
      await this.requestCalendar<void>({
        method: "DELETE",
        path: `/calendars/${encodeURIComponent(this.appConfigService.values.googleCalendarId)}/events/${encodeURIComponent(normalizedEventId)}`,
        operation: "cancel",
        trainingId: input.trainingId,
      });
      return {
        mode: "real",
        alreadyDeleted: false,
      };
    } catch (error) {
      if (this.isGoogleNotFoundError(error)) {
        this.logger.warn("Calendar event already removed, cancel treated as success", {
          trainingId: input.trainingId,
          eventId: normalizedEventId,
        });
        return {
          mode: "real",
          alreadyDeleted: true,
        };
      }

      throw error;
    }
  }

  isGoogleNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return error.message.includes("Google Calendar HTTP 404");
  }

  private getSyncMode(): "real" | "mock" {
    const rawMode = this.appConfigService.values.googleCalendarSyncMode;
    return rawMode === "mock" ? "mock" : "real";
  }

  private ensureGoogleCredentials(): { email: string; privateKey: string } {
    const email = this.appConfigService.values.googleServiceAccountEmail.trim();
    const privateKey = this.appConfigService.values.googlePrivateKey.replaceAll("\\n", "\n").trim();

    if (!email || !privateKey) {
      throw new ServiceUnavailableException(
        "Google Calendar credentials are not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY)",
      );
    }

    return { email, privateKey };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAtMs - 60_000 > now) {
      return this.cachedAccessToken.value;
    }

    const { email, privateKey } = this.ensureGoogleCredentials();
    const jwtAssertion = this.buildSignedJwt(email, privateKey);

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtAssertion,
    });

    let response: Response;
    try {
      response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch (error) {
      const normalizedError = error as Error;
      throw new ServiceUnavailableException(
        `Google OAuth token request failed: ${normalizedError.message}`,
      );
    }

    const payload = (await response.json()) as GoogleAccessTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new ServiceUnavailableException(
        `Google OAuth token request failed with HTTP ${response.status}: ${JSON.stringify(payload)}`,
      );
    }

    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.cachedAccessToken = {
      value: payload.access_token,
      expiresAtMs: now + expiresIn * 1000,
    };

    return payload.access_token;
  }

  private buildSignedJwt(serviceEmail: string, privateKey: string): string {
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = issuedAtSeconds + 3600;

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: serviceEmail,
      scope: GOOGLE_CALENDAR_SCOPE,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    };

    const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const unsignedJwt = `${encodedHeader}.${encodedPayload}`;

    const signer = createSign("RSA-SHA256");
    signer.update(unsignedJwt);
    signer.end();
    const signature = signer.sign(privateKey, "base64url");

    return `${unsignedJwt}.${signature}`;
  }

  private async requestCalendar<T>(options: {
    method: "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    operation: "create" | "update" | "cancel";
    trainingId: string;
    body?: Record<string, unknown>;
  }): Promise<T> {
    const token = await this.getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${GOOGLE_CALENDAR_API_BASE_URL}${options.path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      const normalizedError = error as Error;
      throw new ServiceUnavailableException(
        `Google Calendar network request failed: ${normalizedError.message}`,
      );
    }

    if (response.status === 401) {
      this.cachedAccessToken = null;
    }

    if (!response.ok) {
      const fallbackText = await response.text();
      let payload: CalendarApiErrorPayload | undefined;
      try {
        payload = fallbackText ? (JSON.parse(fallbackText) as CalendarApiErrorPayload) : undefined;
      } catch {
        payload = undefined;
      }

      const reason = payload?.error?.errors?.[0]?.reason ?? "unknown";
      const message = (payload?.error?.message ?? fallbackText) || "unknown error";
      const composedMessage = `Google Calendar HTTP ${response.status}, reason=${reason}, message=${message}`;

      this.logger.warn("Google Calendar request failed", {
        operation: options.operation,
        trainingId: options.trainingId,
        statusCode: response.status,
        reason,
        message,
      });

      if (response.status === 409) {
        throw new ConflictException(composedMessage);
      }

      throw new ServiceUnavailableException(composedMessage);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private buildCalendarEventBody(input: CreateOrUpdateEventInput): Record<string, unknown> {
    const normalizedUsername = input.clientUsername?.trim().replace(/^@/, "") ?? null;
    const telegramLink = normalizedUsername ? `https://t.me/${normalizedUsername}` : null;

    const lines = [
      `Клиент: ${input.clientName}`,
      `Телефон: ${input.clientPhone ?? "не указан"}`,
      telegramLink ? `Username: @${normalizedUsername}` : "Username: не указан",
      telegramLink ? `Telegram: ${telegramLink}` : `Telegram ID: ${input.clientTelegramId}`,
      input.trainerComment ? `Комментарий тренера: ${input.trainerComment}` : null,
    ].filter((line): line is string => Boolean(line));

    return {
      summary: `Тренировка: ${input.clientName}`,
      description: lines.join("\n"),
      start: {
        dateTime: input.startAt.toISOString(),
        timeZone: CALENDAR_TIMEZONE,
      },
      end: {
        dateTime: input.endAt.toISOString(),
        timeZone: CALENDAR_TIMEZONE,
      },
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: "popup",
            minutes: 1440,
          },
          {
            method: "popup",
            minutes: 60,
          },
        ],
      },
    };
  }
}
