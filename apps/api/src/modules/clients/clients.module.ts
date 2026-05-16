import { Module } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { ClientsController } from "./clients.controller";
import { ClientsService } from "./clients.service";

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, AppConfigService],
  exports: [ClientsService],
})
export class ClientsModule {}
