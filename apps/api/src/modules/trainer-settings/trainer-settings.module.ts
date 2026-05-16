import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { TrainerSettingsController } from "./trainer-settings.controller";
import { TrainerSettingsService } from "./trainer-settings.service";

@Module({
  imports: [PrismaModule],
  controllers: [TrainerSettingsController],
  providers: [TrainerSettingsService, AppConfigService],
  exports: [TrainerSettingsService],
})
export class TrainerSettingsModule {}
