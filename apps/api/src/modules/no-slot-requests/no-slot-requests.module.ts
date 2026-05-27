import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { TelegramNotificationsModule } from "../telegram-notifications/telegram-notifications.module";
import { NoSlotRequestsController } from "./no-slot-requests.controller";
import { NoSlotRequestsService } from "./no-slot-requests.service";

@Module({
  imports: [PrismaModule, TelegramNotificationsModule],
  controllers: [NoSlotRequestsController],
  providers: [NoSlotRequestsService, AppConfigService],
  exports: [NoSlotRequestsService],
})
export class NoSlotRequestsModule {}
