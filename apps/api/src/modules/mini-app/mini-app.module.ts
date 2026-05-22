import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { BookingsModule } from "../bookings/bookings.module";
import { ClientsModule } from "../clients/clients.module";
import { NoSlotRequestsModule } from "../no-slot-requests/no-slot-requests.module";
import { SlotsModule } from "../slots/slots.module";
import { TrainerSettingsModule } from "../trainer-settings/trainer-settings.module";
import { MiniAppAuthGuard } from "./mini-app-auth.guard";
import { MiniAppAuthService } from "./mini-app-auth.service";
import { MiniAppController } from "./mini-app.controller";
import { MiniAppTrainerGuard } from "./mini-app-trainer.guard";

@Module({
  imports: [ClientsModule, SlotsModule, BookingsModule, NoSlotRequestsModule, TrainerSettingsModule],
  controllers: [MiniAppController],
  providers: [MiniAppAuthService, MiniAppAuthGuard, MiniAppTrainerGuard, AppConfigService],
  exports: [MiniAppAuthService],
})
export class MiniAppModule {}
