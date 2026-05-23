import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

import { AppConfigService } from "../../config/app-config.service";
import { ClientsService } from "../clients/clients.service";
import { MiniAppRole, MiniAppSessionPayload, MiniAppSessionResponse, MiniAppSupportContact } from "./mini-app-auth.types";

interface ParsedTelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

interface CreateDevSessionInput {
  telegramId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface MiniAppMeResponse {
  status: "ok";
  session: MiniAppSessionPayload;
  profile: Awaited<ReturnType<ClientsService["findByTelegramId"]>>;
  needsProfileCompletion: boolean;
  supportContact: MiniAppSupportContact;
}

const WEB_APP_DATA_KEY = "WebAppData";
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

@Injectable()
export class MiniAppAuthService {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly clientsService: ClientsService,
  ) {}

  async createSessionFromInitData(initData: string): Promise<MiniAppSessionResponse> {
    const rawInitData = initData.trim();
    if (!rawInitData) {
      throw new BadRequestException("initData is required");
    }

    const parsed = this.validateInitData(rawInitData);
    const user = this.parseUser(parsed.get("user"));
    const session = this.createSessionPayload({
      telegramId: String(user.id),
      username: user.username ?? null,
      firstName: user.first_name?.trim() || "Пользователь",
      lastName: user.last_name?.trim() || null,
      photoUrl: user.photo_url?.trim() || null,
    });

    return {
      status: "ok",
      token: this.signSession(session),
      session,
    };
  }

  async createDevSession(input: CreateDevSessionInput): Promise<MiniAppSessionResponse> {
    if (this.appConfigService.values.nodeEnv === "production" && !this.appConfigService.values.miniAppEnableDevLogin) {
      throw new ForbiddenException("Dev login is not available in production");
    }

    const telegramId = input.telegramId.trim();
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    const session = this.createSessionPayload({
      telegramId,
      username: input.username?.trim() || null,
      firstName: input.firstName?.trim() || "Локальный пользователь",
      lastName: input.lastName?.trim() || null,
      photoUrl: null,
    });

    return {
      status: "ok",
      token: this.signSession(session),
      session,
    };
  }

  async getMe(session: MiniAppSessionPayload): Promise<MiniAppMeResponse> {
    const profile = await this.clientsService.findByTelegramId(session.telegramId);

    return {
      status: "ok",
      session,
      profile,
      needsProfileCompletion: profile === null,
      supportContact: {
        telegramId: this.appConfigService.values.adminTelegramId,
        telegramUrl: "https://t.me/RostPV",
        label: "Написать тренеру",
      },
    };
  }

  verifySessionToken(token: string): MiniAppSessionPayload {
    const rawToken = token.trim();
    if (!rawToken) {
      throw new UnauthorizedException("Missing mini app token");
    }

    const [encodedPayload, providedSignature] = rawToken.split(".");
    if (!encodedPayload || !providedSignature) {
      throw new UnauthorizedException("Invalid mini app token format");
    }

    const expectedSignature = this.signTokenPart(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new UnauthorizedException("Invalid mini app token signature");
    }

    const payloadJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as MiniAppSessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      throw new UnauthorizedException("Mini app token has expired");
    }

    return payload;
  }

  private createSessionPayload(input: {
    telegramId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    photoUrl: string | null;
  }): MiniAppSessionPayload {
    const now = Math.floor(Date.now() / 1000);

    return {
      telegramId: input.telegramId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      photoUrl: input.photoUrl,
      role: this.resolveRole(input.telegramId),
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    };
  }

  private resolveRole(telegramId: string): MiniAppRole {
    const { adminTelegramId, trainerTelegramId } = this.appConfigService.values;

    if (telegramId === adminTelegramId || telegramId === trainerTelegramId) {
      return "trainer";
    }

    return "client";
  }

  private validateInitData(initData: string): URLSearchParams {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) {
      throw new UnauthorizedException("initData hash is missing");
    }

    const authDate = Number(params.get("auth_date") ?? "");
    if (!Number.isFinite(authDate)) {
      throw new UnauthorizedException("initData auth_date is invalid");
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > INIT_DATA_MAX_AGE_SECONDS) {
      throw new UnauthorizedException("initData is too old");
    }

    const entries = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`);

    const dataCheckString = entries.join("\n");
    const secretKey = createHmac("sha256", WEB_APP_DATA_KEY)
      .update(this.appConfigService.values.telegramBotToken)
      .digest();
    const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const providedBuffer = Buffer.from(hash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new UnauthorizedException("initData signature is invalid");
    }

    return params;
  }

  private parseUser(rawUser: string | null): ParsedTelegramUser {
    if (!rawUser) {
      throw new UnauthorizedException("initData user is missing");
    }

    try {
      return JSON.parse(rawUser) as ParsedTelegramUser;
    } catch {
      throw new UnauthorizedException("initData user is invalid");
    }
  }

  private signSession(session: MiniAppSessionPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
    return `${encodedPayload}.${this.signTokenPart(encodedPayload)}`;
  }

  private signTokenPart(encodedPayload: string): string {
    return createHmac("sha256", this.appConfigService.values.miniAppAuthSecret)
      .update(encodedPayload)
      .digest("base64url");
  }
}
