import { BadRequestException, Body, Controller, Get, Post, Query } from "@nestjs/common";

import { TrainerSettingsService } from "./trainer-settings.service";

interface TrainerSettingsQuery {
  trainerTelegramId?: string;
}

interface UpdateTrainerSettingsBody {
  trainerTelegramId?: string;
  bookingHorizonDays?: number;
  sameDayBookingCutoff?: number;
}

@Controller("trainer-settings")
export class TrainerSettingsController {
  constructor(private readonly trainerSettingsService: TrainerSettingsService) {}

  @Get("current")
  async current(@Query() query: TrainerSettingsQuery) {
    return {
      status: "ok",
      settings: await this.trainerSettingsService.getCurrent({
        trainerTelegramId: query.trainerTelegramId ?? "",
      }),
    };
  }

  @Post("update")
  async update(@Body() body: UpdateTrainerSettingsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return {
      status: "updated",
      settings: await this.trainerSettingsService.update({
        trainerTelegramId: body.trainerTelegramId ?? "",
        bookingHorizonDays: body.bookingHorizonDays,
        sameDayBookingCutoff: body.sameDayBookingCutoff,
      }),
    };
  }
}
