import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { GoogleCalendarService } from "./google-calendar.service";

@Module({
  providers: [GoogleCalendarService, AppConfigService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}

