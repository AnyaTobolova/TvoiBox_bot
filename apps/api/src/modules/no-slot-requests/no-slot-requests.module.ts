import { Module } from "@nestjs/common";

import { PrismaModule } from "../../prisma/prisma.module";
import { NoSlotRequestsController } from "./no-slot-requests.controller";
import { NoSlotRequestsService } from "./no-slot-requests.service";

@Module({
  imports: [PrismaModule],
  controllers: [NoSlotRequestsController],
  providers: [NoSlotRequestsService],
})
export class NoSlotRequestsModule {}

