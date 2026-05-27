import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { TelegramNotificationsService } from "./telegram-notifications.service";

@Module({
  providers: [TelegramNotificationsService, AppConfigService],
  exports: [TelegramNotificationsService],
})
export class TelegramNotificationsModule {}
