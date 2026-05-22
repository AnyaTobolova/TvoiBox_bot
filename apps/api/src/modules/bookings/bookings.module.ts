import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { GoogleCalendarModule } from "../google-calendar/google-calendar.module";
import { BookingsController } from "./bookings.controller";
import { BookingsService } from "./bookings.service";

@Module({
  imports: [PrismaModule, GoogleCalendarModule],
  controllers: [BookingsController],
  providers: [BookingsService, AppConfigService],
  exports: [BookingsService],
})
export class BookingsModule {}
