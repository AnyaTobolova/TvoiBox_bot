import { Module } from "@nestjs/common";

import { AppConfigService } from "./config/app-config.service";
import { BookingsModule } from "./modules/bookings/bookings.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { GoogleCalendarModule } from "./modules/google-calendar/google-calendar.module";
import { HealthModule } from "./modules/health/health.module";
import { NoSlotRequestsModule } from "./modules/no-slot-requests/no-slot-requests.module";
import { SlotsModule } from "./modules/slots/slots.module";
import { TrainerSettingsModule } from "./modules/trainer-settings/trainer-settings.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ClientsModule,
    SlotsModule,
    BookingsModule,
    NoSlotRequestsModule,
    GoogleCalendarModule,
    TrainerSettingsModule,
  ],
  providers: [AppConfigService],
})
export class AppModule {}
