import { NoSlotRequestStatus } from "@prisma/client";
import { BadRequestException, Body, Controller, Get, Header, Post, Query, UseGuards } from "@nestjs/common";

import { BookingsService } from "../bookings/bookings.service";
import { ClientsService } from "../clients/clients.service";
import { NoSlotRequestsService } from "../no-slot-requests/no-slot-requests.service";
import { SlotsService } from "../slots/slots.service";
import { TrainerSettingsService } from "../trainer-settings/trainer-settings.service";
import { MiniAppAuthGuard } from "./mini-app-auth.guard";
import { MiniAppAuthService } from "./mini-app-auth.service";
import { MiniAppSession } from "./mini-app-session.decorator";
import { MiniAppSessionPayload } from "./mini-app-auth.types";
import { MiniAppTrainerGuard } from "./mini-app-trainer.guard";

interface InitSessionBody {
  initData?: string;
}

interface DevLoginBody {
  telegramId?: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

interface UpdateProfileBody {
  fullName?: string;
  phone?: string | null;
  note?: string | null;
  consentAccepted?: boolean;
}

interface SlotsQuery {
  from?: string;
  to?: string;
}

interface RequestBookingBody {
  slotId?: string;
  clientComment?: string | null;
}

interface ClientTrainingActionBody {
  bookingId?: string;
  clientComment?: string;
}

interface ClientRescheduleBody extends ClientTrainingActionBody {
  targetSlotId?: string;
}

interface ClientProposalDecisionBody {
  bookingId?: string;
  decisionNote?: string;
}

interface ClientCalendarQuery {
  bookingId?: string;
}

interface CreateNoSlotRequestBody {
  preferredDays?: string[];
  preferredTime?: string | null;
  clientComment?: string | null;
}

interface TrainerBookingActionBody {
  bookingId?: string;
}

interface TrainerRejectBody extends TrainerBookingActionBody {
  trainerComment?: string;
}

interface TrainerProposeTimeBody extends TrainerBookingActionBody {
  proposedStartAt?: string;
  trainerComment?: string;
}

interface TrainerRescheduleTrainingBody extends TrainerBookingActionBody {
  newStartAt?: string;
  trainerComment?: string;
}

interface TrainerCancelTrainingBody extends TrainerBookingActionBody {
  trainerComment?: string;
}

interface TrainerForceCloseBody extends TrainerBookingActionBody {
  trainerComment?: string;
}

interface TrainerOpenSlotsBody {
  startAt?: string;
  endAt?: string;
}

interface TrainerCloseSlotsBody extends TrainerOpenSlotsBody {
  slotId?: string;
  reason?: string | null;
}

interface TrainerSettingsBody {
  bookingHorizonDays?: number;
  sameDayBookingCutoff?: number;
  workingDays?: string[];
  workdayStartHour?: number;
  workdayEndHour?: number;
}

interface SearchClientsQuery {
  q?: string;
  limit?: string;
}

interface TrainerBlacklistBody {
  clientId?: string;
  reason?: string;
}

interface TrainerNoSlotRequestsQuery {
  status?: string;
}

interface UpdateNoSlotRequestBody {
  requestId?: string;
  status?: string;
  trainerComment?: string | null;
}

@Controller("mini-app")
export class MiniAppController {
  constructor(
    private readonly miniAppAuthService: MiniAppAuthService,
    private readonly clientsService: ClientsService,
    private readonly slotsService: SlotsService,
    private readonly bookingsService: BookingsService,
    private readonly noSlotRequestsService: NoSlotRequestsService,
    private readonly trainerSettingsService: TrainerSettingsService,
  ) {}

  @Post("session")
  async initSession(@Body() body: InitSessionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.miniAppAuthService.createSessionFromInitData(body.initData ?? "");
  }

  @Post("session/dev-login")
  async devLogin(@Body() body: DevLoginBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.miniAppAuthService.createDevSession({
      telegramId: body.telegramId ?? "",
      username: body.username ?? null,
      firstName: body.firstName ?? null,
      lastName: body.lastName ?? null,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("me")
  async me(@MiniAppSession() session: MiniAppSessionPayload) {
    return this.miniAppAuthService.getMe(session);
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("me")
  async updateProfile(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: UpdateProfileBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return {
      status: "updated",
      profile: await this.clientsService.upsertClientProfile({
        telegramId: session.telegramId,
        username: session.username,
        fullName: body.fullName ?? "",
        phone: body.phone ?? null,
        note: body.note ?? null,
        consentAccepted: body.consentAccepted,
      }),
    };
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("client/slots")
  async getClientSlots(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SlotsQuery) {
    return this.slotsService.getAvailableSlots({
      telegramId: session.telegramId,
      from: query.from,
      to: query.to,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("client/closure-info")
  async getClientClosureInfo(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SlotsQuery) {
    return this.slotsService.getClientClosureInfo({
      telegramId: session.telegramId,
      from: query.from,
      to: query.to,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("client/booking-rules")
  async getClientBookingRules() {
    return {
      status: "ok",
      settings: await this.trainerSettingsService.getPublicSettings(),
    };
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/bookings/request")
  async requestBooking(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: RequestBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.createBookingRequest({
      telegramId: session.telegramId,
      slotId: body.slotId ?? "",
      clientComment: body.clientComment ?? null,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("client/trainings")
  async getClientTrainings(@MiniAppSession() session: MiniAppSessionPayload) {
    return this.bookingsService.getClientTrainings({
      telegramId: session.telegramId,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Get("client/trainings/calendar")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  async downloadClientTrainingCalendar(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: ClientCalendarQuery) {
    if (!query || typeof query !== "object") {
      throw new BadRequestException("Invalid query");
    }

    const file = await this.bookingsService.getClientTrainingCalendarFile(
      session.telegramId,
      query.bookingId ?? "",
    );

    return file.content;
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/trainings/cancel")
  async cancelClientTraining(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: ClientTrainingActionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.cancelTrainingByClient({
      telegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      clientComment: body.clientComment,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/trainings/reschedule")
  async rescheduleClientTraining(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: ClientRescheduleBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rescheduleTrainingByClient({
      telegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      targetSlotId: body.targetSlotId ?? "",
      clientComment: body.clientComment,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/trainings/archive")
  async archiveClientTraining(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: ClientTrainingActionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.archiveTrainingByClient({
      telegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/bookings/proposal/accept")
  async acceptProposal(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: ClientProposalDecisionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.acceptProposedBookingTime({
      telegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      decisionNote: body.decisionNote,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/bookings/proposal/decline")
  async declineProposal(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: ClientProposalDecisionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.declineProposedBookingTime({
      telegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      decisionNote: body.decisionNote,
    });
  }

  @UseGuards(MiniAppAuthGuard)
  @Post("client/no-slot-requests")
  async createNoSlotRequest(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: CreateNoSlotRequestBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.noSlotRequestsService.createRequest({
      telegramId: session.telegramId,
      preferredDays: body.preferredDays ?? [],
      preferredTime: body.preferredTime ?? null,
      clientComment: body.clientComment ?? null,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/bookings")
  async getTrainerBookings(@MiniAppSession() session: MiniAppSessionPayload) {
    return this.bookingsService.getPendingBookings({
      trainerTelegramId: session.telegramId,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/bookings/calendar")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  async downloadTrainerBookingCalendar(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: ClientCalendarQuery) {
    if (!query || typeof query !== "object") {
      throw new BadRequestException("Invalid query");
    }

    const file = await this.bookingsService.getTrainerBookingCalendarFile(
      session.telegramId,
      query.bookingId ?? "",
    );

    return file.content;
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/bookings/confirm")
  async confirmTrainerBooking(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerBookingActionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.confirmBooking({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/bookings/reject")
  async rejectTrainerBooking(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerRejectBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rejectBooking({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/bookings/propose-time")
  async proposeTrainerBookingTime(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerProposeTimeBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.proposeBookingTime({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      proposedStartAt: body.proposedStartAt ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/trainings")
  async getTrainerTrainings(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SlotsQuery) {
    return this.bookingsService.getTrainerTrainings({
      trainerTelegramId: session.telegramId,
      from: query.from,
      to: query.to,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/trainings/cancel")
  async cancelTrainerTraining(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerCancelTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.cancelConfirmedTraining({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/trainings/reschedule")
  async rescheduleTrainerTraining(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerRescheduleTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rescheduleConfirmedTraining({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      newStartAt: body.newStartAt ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/trainings/force-close")
  async forceCloseTrainerBooking(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerForceCloseBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.forceCloseBooking({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/trainings/archive")
  async archiveTrainerBooking(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerBookingActionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.archiveBookingByTrainer({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/trainings/resync-calendar")
  async resyncTrainerCalendar(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerBookingActionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.resyncBookingCalendar({
      trainerTelegramId: session.telegramId,
      bookingId: body.bookingId ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/slots")
  async getTrainerSlots(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SlotsQuery) {
    return this.slotsService.getTrainerSlots({
      trainerTelegramId: session.telegramId,
      from: query.from ?? "",
      to: query.to ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/slots/open")
  async openTrainerSlots(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerOpenSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.openSlots({
      trainerTelegramId: session.telegramId,
      startAt: body.startAt ?? "",
      endAt: body.endAt,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/slots/close")
  async closeTrainerSlots(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerCloseSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.closeSlots({
      trainerTelegramId: session.telegramId,
      slotId: body.slotId,
      startAt: body.startAt,
      endAt: body.endAt,
      reason: body.reason,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/slots/reopen")
  async reopenTrainerSlots(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerOpenSlotsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.slotsService.reopenSlots({
      trainerTelegramId: session.telegramId,
      startAt: body.startAt ?? "",
      endAt: body.endAt,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/slots/closed-periods")
  async getTrainerClosedPeriods(@MiniAppSession() session: MiniAppSessionPayload) {
    return {
      status: "ok",
      items: await this.slotsService.listClosedPeriods(session.telegramId),
    };
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/settings")
  async getTrainerSettings(@MiniAppSession() session: MiniAppSessionPayload) {
    return {
      status: "ok",
      settings: await this.trainerSettingsService.getCurrent({
        trainerTelegramId: session.telegramId,
      }),
    };
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/settings")
  async updateTrainerSettings(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerSettingsBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return {
      status: "updated",
      settings: await this.trainerSettingsService.update({
        trainerTelegramId: session.telegramId,
        bookingHorizonDays: body.bookingHorizonDays,
        sameDayBookingCutoff: body.sameDayBookingCutoff,
        workingDays: body.workingDays,
        workdayStartHour: body.workdayStartHour,
        workdayEndHour: body.workdayEndHour,
      }),
    };
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/clients/search")
  async searchTrainerClients(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SearchClientsQuery) {
    const parsedLimit = Number(query.limit ?? "10");
    return {
      status: "ok",
      items: await this.clientsService.searchClients({
        trainerTelegramId: session.telegramId,
        query: query.q ?? "",
        limit: Number.isFinite(parsedLimit) ? parsedLimit : 10,
      }),
    };
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/clients/blacklist")
  async getTrainerBlacklist(@MiniAppSession() session: MiniAppSessionPayload) {
    return {
      status: "ok",
      items: await this.clientsService.listBlacklistedClients(session.telegramId),
    };
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/clients/blacklist/add")
  async addTrainerBlacklist(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerBlacklistBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.clientsService.addToBlacklist({
      trainerTelegramId: session.telegramId,
      clientId: body.clientId ?? "",
      reason: body.reason ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/clients/blacklist/remove")
  async removeTrainerBlacklist(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: TrainerBlacklistBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.clientsService.removeFromBlacklist({
      trainerTelegramId: session.telegramId,
      clientId: body.clientId ?? "",
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/no-slot-requests")
  async getTrainerNoSlotRequests(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: TrainerNoSlotRequestsQuery) {
    return this.noSlotRequestsService.listForTrainer({
      trainerTelegramId: session.telegramId,
      status: this.parseNoSlotStatus(query.status),
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Post("trainer/no-slot-requests/update")
  async updateTrainerNoSlotRequest(@MiniAppSession() session: MiniAppSessionPayload, @Body() body: UpdateNoSlotRequestBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.noSlotRequestsService.updateByTrainer({
      trainerTelegramId: session.telegramId,
      requestId: body.requestId ?? "",
      status: this.parseNoSlotStatus(body.status) ?? NoSlotRequestStatus.REVIEWED,
      trainerComment: body.trainerComment ?? null,
    });
  }

  @UseGuards(MiniAppAuthGuard, MiniAppTrainerGuard)
  @Get("trainer/export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="tvoy-box-mini-app-export.csv"')
  async exportTrainerData(@MiniAppSession() session: MiniAppSessionPayload, @Query() query: SlotsQuery) {
    const [bookings, trainings, noSlotRequests] = await Promise.all([
      this.bookingsService.getPendingBookings({
        trainerTelegramId: session.telegramId,
      }),
      this.bookingsService.getTrainerTrainings({
        trainerTelegramId: session.telegramId,
        from: query.from,
        to: query.to,
      }),
      this.noSlotRequestsService.listForTrainer({
        trainerTelegramId: session.telegramId,
      }),
    ]);

    const rows: string[][] = [
      [
        "Тип",
        "Статус",
        "Клиент",
        "Telegram ID",
        "Телефон",
        "Начало",
        "Конец",
        "Комментарий клиента",
        "Комментарий тренера",
        "Дополнительно",
      ],
    ];

    for (const item of bookings.items) {
      rows.push([
        "Заявка",
        item.status,
        item.client.fullName,
        item.client.telegramId,
        item.client.phone ?? "",
        item.slot.startAt,
        item.slot.endAt,
        item.clientComment ?? "",
        item.trainerComment ?? "",
        "",
      ]);
    }

    for (const item of trainings.items) {
      rows.push([
        "Тренировка",
        item.bookingStatus,
        item.client.fullName,
        item.client.telegramId,
        item.client.phone ?? "",
        item.startAt,
        item.endAt,
        item.clientComment ?? "",
        item.trainerComment ?? "",
        item.trainingStatus,
      ]);
    }

    for (const item of noSlotRequests.items) {
      rows.push([
        "Запрос без слота",
        item.status,
        item.client.fullName,
        item.client.telegramId,
        item.client.phone ?? "",
        item.createdAt,
        "",
        item.clientComment ?? "",
        item.trainerComment ?? "",
        `${item.preferredDays.join(", ")}${item.preferredTime ? ` | ${item.preferredTime}` : ""}`,
      ]);
    }

    return `\uFEFF${rows.map((row) => row.map((value) => this.toCsvCell(value)).join(",")).join("\n")}`;
  }

  private parseNoSlotStatus(rawStatus?: string): NoSlotRequestStatus | undefined {
    if (!rawStatus?.trim()) {
      return undefined;
    }

    switch (rawStatus.trim().toUpperCase()) {
      case NoSlotRequestStatus.NEW:
        return NoSlotRequestStatus.NEW;
      case NoSlotRequestStatus.REVIEWED:
        return NoSlotRequestStatus.REVIEWED;
      case NoSlotRequestStatus.ARCHIVED:
        return NoSlotRequestStatus.ARCHIVED;
      default:
        throw new BadRequestException("Unsupported no-slot request status");
    }
  }

  private toCsvCell(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
}
