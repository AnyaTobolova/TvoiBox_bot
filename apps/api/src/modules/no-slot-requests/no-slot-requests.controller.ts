import { BadRequestException, Body, Controller, Post } from "@nestjs/common";

import { NoSlotRequestsService } from "./no-slot-requests.service";

interface CreateNoSlotRequestBody {
  telegramId?: string;
  preferredDays?: string[];
  preferredTime?: string | null;
  clientComment?: string | null;
}

@Controller("no-slot-requests")
export class NoSlotRequestsController {
  constructor(private readonly noSlotRequestsService: NoSlotRequestsService) {}

  @Post("request")
  async createRequest(@Body() body: CreateNoSlotRequestBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.noSlotRequestsService.createRequest({
      telegramId: body.telegramId ?? "",
      preferredDays: body.preferredDays ?? [],
      preferredTime: body.preferredTime ?? null,
      clientComment: body.clientComment ?? null,
    });
  }
}

