import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { ClientsService } from "./clients.service";

interface RegisterClientBody {
  telegramId?: string;
  username?: string | null;
  fullName?: string;
  phone?: string | null;
  consentAccepted?: boolean;
}

interface BlacklistQuery {
  trainerTelegramId?: string;
}

interface RemoveFromBlacklistBody {
  trainerTelegramId?: string;
  clientId?: string;
}

interface SearchClientsQuery {
  trainerTelegramId?: string;
  q?: string;
  limit?: string;
}

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get("telegram/:telegramId")
  async findByTelegramId(@Param("telegramId") telegramId: string) {
    const client = await this.clientsService.findByTelegramId(telegramId.trim());

    if (!client) {
      return {
        found: false,
      };
    }

    return {
      found: true,
      client,
    };
  }

  @Post("register")
  async register(@Body() body: RegisterClientBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    const result = await this.clientsService.registerClient({
      telegramId: body.telegramId ?? "",
      username: body.username ?? null,
      fullName: body.fullName ?? "",
      phone: body.phone ?? null,
      consentAccepted: Boolean(body.consentAccepted),
    });

    return result;
  }

  @Get("blacklist")
  async listBlacklist(@Query() query: BlacklistQuery) {
    return {
      status: "ok",
      items: await this.clientsService.listBlacklistedClients(query.trainerTelegramId ?? ""),
    };
  }

  @Get("search")
  async searchClients(@Query() query: SearchClientsQuery) {
    const parsedLimit = Number(query.limit ?? "10");
    return {
      status: "ok",
      items: await this.clientsService.searchClients({
        trainerTelegramId: query.trainerTelegramId ?? "",
        query: query.q ?? "",
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 10,
      }),
    };
  }

  @Post("blacklist/remove")
  async removeFromBlacklist(@Body() body: RemoveFromBlacklistBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return await this.clientsService.removeFromBlacklist({
      trainerTelegramId: body.trainerTelegramId ?? "",
      clientId: body.clientId ?? "",
    });
  }
}
