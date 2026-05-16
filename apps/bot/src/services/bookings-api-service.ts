interface CreateBookingPayload {
  telegramId: string;
  slotId: string;
  clientComment?: string | null;
}

export type BookingStatusType = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "RESCHEDULED";

interface BookingDto {
  id: string;
  status: BookingStatusType;
  createdAt: string;
  expiresAt: string;
  clientComment: string | null;
  trainerComment: string | null;
  client: {
    id: string;
    telegramId: string;
    fullName: string;
    username: string | null;
    phone: string | null;
  };
  slot: {
    id: string;
    startAt: string;
    endAt: string;
    status: "OPEN" | "HELD" | "BOOKED" | "CLOSED" | "CANCELLED";
  };
}

interface CreateBookingResponse {
  status: "created";
  booking: {
    id: string;
    slotId: string;
    status: BookingStatusType;
    expiresAt: string;
    startAt: string;
    endAt: string;
  };
}

interface PendingBookingsResponse {
  status: "ok";
  items: BookingDto[];
}

interface BookingActionResponse {
  status: "confirmed" | "rejected" | "proposed" | "cancelled" | "rescheduled" | "resynced" | "archived";
  booking: BookingDto;
}

interface ClientTrainingDto {
  bookingId: string;
  bookingStatus: BookingStatusType;
  trainingStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "RESCHEDULED" | null;
  startAt: string;
  endAt: string;
  trainerComment: string | null;
  clientComment: string | null;
  canCancel: boolean;
  canReschedule: boolean;
  canDelete: boolean;
}

interface ClientTrainingsResponse {
  status: "ok";
  items: ClientTrainingDto[];
}

interface ClientTrainingActionPayload {
  telegramId: string;
  bookingId: string;
  clientComment?: string;
}

interface ClientRescheduleTrainingPayload extends ClientTrainingActionPayload {
  targetSlotId: string;
}

interface ConfirmBookingPayload {
  trainerTelegramId: string;
  bookingId: string;
}

interface RejectBookingPayload extends ConfirmBookingPayload {
  trainerComment: string;
}

interface ProposeTimePayload extends RejectBookingPayload {
  proposedStartAt: string;
}

interface RescheduleTrainingPayload extends RejectBookingPayload {
  newStartAt: string;
}

interface ClientProposalDecisionPayload {
  telegramId: string;
  bookingId: string;
  decisionNote?: string;
}

interface ForceCloseBookingPayload {
  bookingId: string;
  trainerComment: string;
}

interface ResyncCalendarPayload {
  bookingId: string;
}

interface TrainerArchiveBookingPayload {
  bookingId: string;
}

export class BookingsApiService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trainerTelegramId: string,
  ) {}

  async requestBooking(payload: CreateBookingPayload): Promise<CreateBookingResponse> {
    return this.requestJson<CreateBookingResponse>("/bookings/request", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getPendingBookings(): Promise<PendingBookingsResponse> {
    const query = new URLSearchParams({
      trainerTelegramId: this.trainerTelegramId,
    });

    return this.requestJson<PendingBookingsResponse>(`/bookings/pending?${query.toString()}`, {
      method: "GET",
    });
  }

  async getBookingDetails(bookingId: string): Promise<BookingDto> {
    const query = new URLSearchParams({
      trainerTelegramId: this.trainerTelegramId,
    });

    return this.requestJson<BookingDto>(`/bookings/${encodeURIComponent(bookingId)}?${query.toString()}`, {
      method: "GET",
    });
  }

  async confirmBooking(payload: Omit<ConfirmBookingPayload, "trainerTelegramId">): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/confirm", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async rejectBooking(payload: Omit<RejectBookingPayload, "trainerTelegramId">): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/reject", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async proposeTime(payload: Omit<ProposeTimePayload, "trainerTelegramId">): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/propose-time", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async cancelTraining(payload: Omit<RejectBookingPayload, "trainerTelegramId">): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/cancel-training", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async rescheduleTraining(
    payload: Omit<RescheduleTrainingPayload, "trainerTelegramId">,
  ): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/reschedule-training", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async acceptProposal(payload: ClientProposalDecisionPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/proposal/accept", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async declineProposal(payload: ClientProposalDecisionPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/proposal/decline", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getClientTrainings(telegramId: string): Promise<ClientTrainingsResponse> {
    const query = new URLSearchParams({
      telegramId,
    });

    return this.requestJson<ClientTrainingsResponse>(`/bookings/client/trainings?${query.toString()}`, {
      method: "GET",
    });
  }

  async cancelTrainingByClient(payload: ClientTrainingActionPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/client/cancel-training", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async rescheduleTrainingByClient(payload: ClientRescheduleTrainingPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/client/reschedule-training", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async archiveTrainingByClient(payload: ClientTrainingActionPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/client/archive", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async forceCloseBooking(payload: ForceCloseBookingPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/force-close", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async archiveBookingByTrainer(payload: TrainerArchiveBookingPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/trainer/archive", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  async resyncCalendar(payload: ResyncCalendarPayload): Promise<BookingActionResponse> {
    return this.requestJson<BookingActionResponse>("/bookings/resync-calendar", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });
  }

  private async requestJson<T>(path: string, options: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bookings API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  }
}
