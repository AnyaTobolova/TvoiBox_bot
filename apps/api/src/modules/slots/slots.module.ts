import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { SlotsController } from "./slots.controller";
import { SlotsService } from "./slots.service";

@Module({
  controllers: [SlotsController],
  providers: [SlotsService, AppConfigService],
  exports: [SlotsService],
})
export class SlotsModule {}
