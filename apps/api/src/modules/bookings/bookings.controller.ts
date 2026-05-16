import { BadRequestException, Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { BookingsService } from "./bookings.service";

interface CreateBookingBody {
  telegramId?: string;
  slotId?: string;
  clientComment?: string | null;
}

interface PendingBookingsQuery {
  trainerTelegramId?: string;
}

interface BookingDetailsQuery {
  trainerTelegramId?: string;
}

interface ConfirmBookingBody {
  trainerTelegramId?: string;
  bookingId?: string;
}

interface RejectBookingBody {
  trainerTelegramId?: string;
  bookingId?: string;
  trainerComment?: string;
}

interface ProposeBookingTimeBody {
  trainerTelegramId?: string;
  bookingId?: string;
  proposedStartAt?: string;
  trainerComment?: string;
}

interface CancelConfirmedTrainingBody {
  trainerTelegramId?: string;
  bookingId?: string;
  trainerComment?: string;
}

interface RescheduleConfirmedTrainingBody {
  trainerTelegramId?: string;
  bookingId?: string;
  newStartAt?: string;
  trainerComment?: string;
}

interface ClientProposalDecisionBody {
  telegramId?: string;
  bookingId?: string;
  decisionNote?: string;
}

interface ClientTrainingsQuery {
  telegramId?: string;
}

interface ClientCancelTrainingBody {
  telegramId?: string;
  bookingId?: string;
  clientComment?: string;
}

interface ClientRescheduleTrainingBody {
  telegramId?: string;
  bookingId?: string;
  targetSlotId?: string;
  clientComment?: string;
}

interface ClientArchiveTrainingBody {
  telegramId?: string;
  bookingId?: string;
}

interface ForceCloseBookingBody {
  trainerTelegramId?: string;
  bookingId?: string;
  trainerComment?: string;
}

interface TrainerArchiveBookingBody {
  trainerTelegramId?: string;
  bookingId?: string;
}

interface ResyncBookingCalendarBody {
  trainerTelegramId?: string;
  bookingId?: string;
}

@Controller("bookings")
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post("request")
  async requestBooking(@Body() body: CreateBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.createBookingRequest({
      telegramId: body.telegramId ?? "",
      slotId: body.slotId ?? "",
      clientComment: body.clientComment,
    });
  }

  @Get("pending")
  async pending(@Query() query: PendingBookingsQuery) {
    return this.bookingsService.getPendingBookings({
      trainerTelegramId: query.trainerTelegramId ?? "",
    });
  }

  @Get(":bookingId")
  async getById(@Param("bookingId") bookingId: string, @Query() query: BookingDetailsQuery) {
    return this.bookingsService.getBookingDetails({
      trainerTelegramId: query.trainerTelegramId ?? "",
      bookingId,
    });
  }

  @Post("confirm")
  async confirm(@Body() body: ConfirmBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.confirmBooking({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
    });
  }

  @Post("reject")
  async reject(@Body() body: RejectBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rejectBooking({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @Post("propose-time")
  async proposeTime(@Body() body: ProposeBookingTimeBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.proposeBookingTime({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
      proposedStartAt: body.proposedStartAt ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @Post("cancel-training")
  async cancelTraining(@Body() body: CancelConfirmedTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.cancelConfirmedTraining({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @Post("reschedule-training")
  async rescheduleTraining(@Body() body: RescheduleConfirmedTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rescheduleConfirmedTraining({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
      newStartAt: body.newStartAt ?? "",
      trainerComment: body.trainerComment ?? "",
    });
  }

  @Post("proposal/accept")
  async acceptProposal(@Body() body: ClientProposalDecisionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.acceptProposedBookingTime({
      telegramId: body.telegramId ?? "",
      bookingId: body.bookingId ?? "",
      decisionNote: body.decisionNote,
    });
  }

  @Post("proposal/decline")
  async declineProposal(@Body() body: ClientProposalDecisionBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.declineProposedBookingTime({
      telegramId: body.telegramId ?? "",
      bookingId: body.bookingId ?? "",
      decisionNote: body.decisionNote,
    });
  }

  @Get("client/trainings")
  async clientTrainings(@Query() query: ClientTrainingsQuery) {
    return this.bookingsService.getClientTrainings({
      telegramId: query.telegramId ?? "",
    });
  }

  @Post("client/cancel-training")
  async clientCancelTraining(@Body() body: ClientCancelTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.cancelTrainingByClient({
      telegramId: body.telegramId ?? "",
      bookingId: body.bookingId ?? "",
      clientComment: body.clientComment,
    });
  }

  @Post("client/reschedule-training")
  async clientRescheduleTraining(@Body() body: ClientRescheduleTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.rescheduleTrainingByClient({
      telegramId: body.telegramId ?? "",
      bookingId: body.bookingId ?? "",
      targetSlotId: body.targetSlotId ?? "",
      clientComment: body.clientComment,
    });
  }

  @Post("client/archive")
  async clientArchiveTraining(@Body() body: ClientArchiveTrainingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.archiveTrainingByClient({
      telegramId: body.telegramId ?? "",
      bookingId: body.bookingId ?? "",
    });
  }

  @Post("force-close")
  async forceClose(@Body() body: ForceCloseBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.forceCloseBooking({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
      trainerComment: body.trainerComment,
    });
  }

  @Post("trainer/archive")
  async trainerArchive(@Body() body: TrainerArchiveBookingBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.archiveBookingByTrainer({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
    });
  }

  @Post("resync-calendar")
  async resyncCalendar(@Body() body: ResyncBookingCalendarBody) {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Invalid request body");
    }

    return this.bookingsService.resyncBookingCalendar({
      trainerTelegramId: body.trainerTelegramId ?? "",
      bookingId: body.bookingId ?? "",
    });
  }
}
