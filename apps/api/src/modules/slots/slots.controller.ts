import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";

import { SlotsService } from "./slots.service";

interface OpenSlotsBody {
  trainerTelegramId?: string;
  startAt?: string;
  endAt?: string;
}

interface CloseSlotsBody {
  trainerTelegramId?: string;
  slotId?: string;
  startAt?: string;
  endAt?: string;
  reason?: string | null;
}

interface AvailableSlotsQuery {
  telegramId?: string;
  from?: string;
  to?: string;
}

interface TrainerSlotsQuery {
  trainerTelegramId?: string;
  from?: string;
  to?: string;
}

interface ClosedPeriodsQuery {
  trainerTelegramId?: string;
}

@Controller("slots")
export class SlotsController {
  constructor(private readonly slotsService: SlotsService) {}

  @Post("open")
  async open(@Body() body: OpenSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.openSlots({
      trainerTelegramId: body.trainerTelegramId ?? "",
      startAt: body.startAt ?? "",
      endAt: body.endAt,
    });
  }

  @Post("close")
  async close(@Body() body: CloseSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.closeSlots({
      trainerTelegramId: body.trainerTelegramId ?? "",
      slotId: body.slotId,
      startAt: body.startAt,
      endAt: body.endAt,
      reason: body.reason,
    });
  }

  @Post("reopen")
  async reopen(@Body() body: OpenSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.reopenSlots({
      trainerTelegramId: body.trainerTelegramId ?? "",
      startAt: body.startAt ?? "",
      endAt: body.endAt,
    });
  }

  @Get("available")
  async available(@Query() query: AvailableSlotsQuery) {
    return this.slotsService.getAvailableSlots({
      telegramId: query.telegramId ?? "",
      from: query.from,
      to: query.to,
    });
  }

  @Get("trainer-grid")
  async trainerGrid(@Query() query: TrainerSlotsQuery) {
    return this.slotsService.getTrainerSlots({
      trainerTelegramId: query.trainerTelegramId ?? "",
      from: query.from ?? "",
      to: query.to ?? "",
    });
  }

  @Get("closure-info")
  async closureInfo(@Query() query: AvailableSlotsQuery) {
    return this.slotsService.getClientClosureInfo({
      telegramId: query.telegramId ?? "",
      from: query.from,
      to: query.to,
    });
  }

  @Get("closed-periods")
  async closedPeriods(@Query() query: ClosedPeriodsQuery) {
    return {
      status: "ok",
      items: await this.slotsService.listClosedPeriods(query.trainerTelegramId ?? ""),
    };
  }
}
