import { isLocalPreviewEnvironment, MiniAppPreviewRuntime } from "./mini-app-preview";

export type MiniAppRole = "client" | "trainer";

export interface MiniAppSession {
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  role: MiniAppRole;
  iat: number;
  exp: number;
}

export interface ClientProfile {
  id: string;
  telegramId: string;
  username: string | null;
  fullName: string;
  phone: string | null;
  note: string | null;
  consentAcceptedAt: string | null;
  isBlacklisted: boolean;
  blacklistReason?: string | null;
  blacklistedAt?: string | null;
}

export interface TrainerSettingsDto {
  bookingHorizonDays: number;
  sameDayBookingCutoff: number;
  workingDays: string[];
  workdayStartHour: number;
  workdayEndHour: number;
  updatedAt: string;
}

export interface MiniAppMeResponse {
  status: "ok";
  session: MiniAppSession;
  profile: ClientProfile | null;
  needsProfileCompletion: boolean;
  supportContact: {
    telegramId: string;
    telegramUrl: string;
    label: string;
  };
}

export interface AvailableSlot {
  id: string;
  startAt: string;
  endAt: string;
  status: "OPEN" | "HELD" | "BOOKED" | "CLOSED" | "CANCELLED";
}

export interface SlotClosureInfo {
  hasClosure: boolean;
  reason: string | null;
  closedFrom: string | null;
  closedUntil: string | null;
  closedSlotsCount: number;
}

export type BookingStatusType = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "RESCHEDULED";

export interface ClientTrainingDto {
  bookingId: string;
  bookingStatus: BookingStatusType;
  trainingStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "RESCHEDULED" | null;
  startAt: string;
  endAt: string;
  clientCalendarIcsUrl: string | null;
  trainerComment: string | null;
  clientComment: string | null;
  isAwaitingTrainerDecision: boolean;
  hasTrainerProposal: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  canDelete: boolean;
}

export interface PendingBookingDto {
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
    status: AvailableSlot["status"];
  };
}

export interface TrainerTrainingDto {
  bookingId: string;
  trainingId: string;
  bookingStatus: BookingStatusType;
  trainingStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED" | "RESCHEDULED";
  startAt: string;
  endAt: string;
  clientCalendarIcsUrl: string | null;
  trainerComment: string | null;
  clientComment: string | null;
  client: ClientProfile;
  canCancel: boolean;
  canReschedule: boolean;
  canResyncCalendar: boolean;
}

export type NoSlotRequestStatusType = "NEW" | "REVIEWED" | "ARCHIVED";

export interface NoSlotRequestDto {
  id: string;
  status: NoSlotRequestStatusType;
  preferredDays: string[];
  preferredTime: string | null;
  clientComment: string | null;
  trainerComment: string | null;
  createdAt: string;
  client: ClientProfile;
}

export interface ClosedPeriodDto {
  startAt: string;
  endAt: string;
  reason: string;
  closedSlotsCount: number;
}

interface SessionResponse {
  status: "ok";
  token: string;
  session: MiniAppSession;
}

interface ClientTrainingsResponse {
  status: "ok";
  items: ClientTrainingDto[];
}

interface TrainerTrainingsResponse {
  status: "ok";
  items: TrainerTrainingDto[];
}

interface PendingBookingsResponse {
  status: "ok";
  items: PendingBookingDto[];
}

interface UpdateProfileResponse {
  status: "updated";
  profile: ClientProfile;
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

interface BookingActionResponse {
  status: "confirmed" | "rejected" | "proposed" | "cancelled" | "rescheduled" | "resynced" | "archived";
  booking?: PendingBookingDto;
}

interface CreateNoSlotRequestResponse {
  status: "created";
}

interface NoSlotRequestsResponse {
  status: "ok";
  items: NoSlotRequestDto[];
}

interface ClosedPeriodsResponse {
  status: "ok";
  items: ClosedPeriodDto[];
}

interface TrainerSettingsResponse {
  status: "ok" | "updated";
  settings: TrainerSettingsDto;
}

interface ClientsResponse {
  status: "ok";
  items: ClientProfile[];
}

export function getMiniAppApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3000";
}

export class MiniAppApi {
  private token: string | null = null;
  private readonly preview = new MiniAppPreviewRuntime();

  constructor(private readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  async createSession(initData: string): Promise<SessionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.createSession();
    }

    return this.request<SessionResponse>("/mini-app/session", {
      method: "POST",
      body: JSON.stringify({ initData }),
    });
  }

  async devLogin(payload: {
    telegramId: string;
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }): Promise<SessionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.devLogin(payload);
    }

    return this.request<SessionResponse>("/mini-app/session/dev-login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getMe(): Promise<MiniAppMeResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getMe(this.requireToken());
    }

    return this.authRequest<MiniAppMeResponse>("/mini-app/me", { method: "GET" });
  }

  async updateProfile(payload: {
    fullName: string;
    phone?: string | null;
    note?: string | null;
    consentAccepted?: boolean;
  }): Promise<UpdateProfileResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.updateProfile(this.requireToken(), payload);
    }

    return this.authRequest<UpdateProfileResponse>("/mini-app/me", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getClientSlots(): Promise<AvailableSlot[]> {
    if (this.shouldUsePreview()) {
      return this.preview.getClientSlots();
    }

    return this.authRequest<AvailableSlot[]>("/mini-app/client/slots", { method: "GET" });
  }

  async getClientClosureInfo(): Promise<SlotClosureInfo> {
    if (this.shouldUsePreview()) {
      return this.preview.getClientClosureInfo();
    }

    return this.authRequest<SlotClosureInfo>("/mini-app/client/closure-info", { method: "GET" });
  }

  async getClientBookingRules(): Promise<TrainerSettingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getClientBookingRules();
    }

    return this.authRequest<TrainerSettingsResponse>("/mini-app/client/booking-rules", { method: "GET" });
  }

  async getClientTrainings(params?: { includeArchived?: boolean }): Promise<ClientTrainingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getClientTrainings(this.requireToken(), params);
    }

    const search = new URLSearchParams();
    if (params?.includeArchived) {
      search.set("includeArchived", "true");
    }
    const suffix = search.toString() ? `?${search.toString()}` : "";

    return this.authRequest<ClientTrainingsResponse>(`/mini-app/client/trainings${suffix}`, { method: "GET" });
  }

  async downloadClientCalendarFile(bookingId: string): Promise<Blob> {
    if (this.shouldUsePreview()) {
      return this.preview.downloadClientCalendarFile(this.requireToken(), bookingId);
    }

    const response = await fetch(
      `${this.baseUrl}/mini-app/client/trainings/calendar?bookingId=${encodeURIComponent(bookingId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.requireToken()}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Mini App API responded with status ${response.status}`);
    }

    return response.blob();
  }

  async downloadTrainerBookingCalendarFile(bookingId: string): Promise<Blob> {
    if (this.shouldUsePreview()) {
      return this.preview.downloadTrainerBookingCalendarFile(this.requireToken(), bookingId);
    }

    const response = await fetch(
      `${this.baseUrl}/mini-app/trainer/bookings/calendar?bookingId=${encodeURIComponent(bookingId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.requireToken()}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Mini App API responded with status ${response.status}`);
    }

    return response.blob();
  }

  async requestBooking(payload: { slotId: string; clientComment?: string | null }): Promise<CreateBookingResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.requestBooking(this.requireToken(), payload);
    }

    return this.authRequest<CreateBookingResponse>("/mini-app/client/bookings/request", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async cancelTraining(payload: { bookingId: string; clientComment?: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.cancelTraining(this.requireToken(), payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/client/trainings/cancel", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async rescheduleTraining(payload: {
    bookingId: string;
    targetSlotId: string;
    clientComment?: string;
  }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.rescheduleTraining(this.requireToken(), payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/client/trainings/reschedule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async acceptProposal(payload: { bookingId: string; decisionNote?: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.acceptProposal(this.requireToken(), payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/client/bookings/proposal/accept", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async declineProposal(payload: { bookingId: string; decisionNote?: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.declineProposal(this.requireToken(), payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/client/bookings/proposal/decline", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async archiveClientTraining(payload: { bookingId: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.archiveClientTraining(this.requireToken(), payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/client/trainings/archive", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createNoSlotRequest(payload: {
    preferredDays: string[];
    preferredTime?: string | null;
    clientComment?: string | null;
  }): Promise<CreateNoSlotRequestResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.createNoSlotRequest(this.requireToken(), payload);
    }

    return this.authRequest<CreateNoSlotRequestResponse>("/mini-app/client/no-slot-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTrainerBookings(): Promise<PendingBookingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerBookings();
    }

    return this.authRequest<PendingBookingsResponse>("/mini-app/trainer/bookings", { method: "GET" });
  }

  async confirmTrainerBooking(payload: { bookingId: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.confirmTrainerBooking(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/bookings/confirm", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async rejectTrainerBooking(payload: { bookingId: string; trainerComment: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.rejectTrainerBooking(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/bookings/reject", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async proposeTrainerBookingTime(payload: {
    bookingId: string;
    proposedStartAt: string;
    trainerComment: string;
  }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.proposeTrainerBookingTime(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/bookings/propose-time", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTrainerTrainings(params?: { from?: string; to?: string; includeArchived?: boolean }): Promise<TrainerTrainingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerTrainings(params);
    }

    const search = new URLSearchParams();
    if (params?.from) {
      search.set("from", params.from);
    }
    if (params?.to) {
      search.set("to", params.to);
    }
    if (params?.includeArchived) {
      search.set("includeArchived", "true");
    }
    const suffix = search.toString() ? `?${search.toString()}` : "";

    return this.authRequest<TrainerTrainingsResponse>(`/mini-app/trainer/trainings${suffix}`, { method: "GET" });
  }

  async cancelTrainerTraining(payload: { bookingId: string; trainerComment: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.cancelTrainerTraining(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/trainings/cancel", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async rescheduleTrainerTraining(payload: {
    bookingId: string;
    newStartAt: string;
    trainerComment: string;
  }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.rescheduleTrainerTraining(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/trainings/reschedule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async forceCloseTrainerBooking(payload: { bookingId: string; trainerComment?: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.forceCloseTrainerBooking(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/trainings/force-close", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async archiveTrainerBooking(payload: { bookingId: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.archiveTrainerBooking(payload);
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/trainings/archive", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async resyncTrainerCalendar(payload: { bookingId: string }): Promise<BookingActionResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.resyncTrainerCalendar();
    }

    return this.authRequest<BookingActionResponse>("/mini-app/trainer/trainings/resync-calendar", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTrainerSlots(params: { from: string; to: string }): Promise<AvailableSlot[]> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerSlots(params);
    }

    const search = new URLSearchParams({
      from: params.from,
      to: params.to,
    });

    return this.authRequest<AvailableSlot[]>(`/mini-app/trainer/slots?${search.toString()}`, { method: "GET" });
  }

  async openTrainerSlots(payload: { startAt: string; endAt?: string }): Promise<void> {
    if (this.shouldUsePreview()) {
      this.preview.openTrainerSlots(payload);
      return;
    }

    await this.authRequest("/mini-app/trainer/slots/open", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async closeTrainerSlots(payload: { slotId?: string; startAt?: string; endAt?: string; reason?: string | null }): Promise<void> {
    if (this.shouldUsePreview()) {
      this.preview.closeTrainerSlots(payload);
      return;
    }

    await this.authRequest("/mini-app/trainer/slots/close", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async reopenTrainerSlots(payload: { startAt: string; endAt?: string }): Promise<void> {
    if (this.shouldUsePreview()) {
      this.preview.reopenTrainerSlots(payload);
      return;
    }

    await this.authRequest("/mini-app/trainer/slots/reopen", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTrainerClosedPeriods(): Promise<ClosedPeriodsResponse> {
    if (this.shouldUsePreview()) {
      return { status: "ok", items: [] };
    }

    return this.authRequest<ClosedPeriodsResponse>("/mini-app/trainer/slots/closed-periods", { method: "GET" });
  }

  async getTrainerSettings(): Promise<TrainerSettingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerSettings();
    }

    return this.authRequest<TrainerSettingsResponse>("/mini-app/trainer/settings", { method: "GET" });
  }

  async updateTrainerSettings(payload: {
    bookingHorizonDays?: number;
    sameDayBookingCutoff?: number;
    workingDays?: string[];
    workdayStartHour?: number;
    workdayEndHour?: number;
  }): Promise<TrainerSettingsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.updateTrainerSettings(payload);
    }

    return this.authRequest<TrainerSettingsResponse>("/mini-app/trainer/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async searchTrainerClients(query: string, limit = 10): Promise<ClientsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.searchTrainerClients(query, limit);
    }

    const search = new URLSearchParams({
      q: query,
      limit: String(limit),
    });

    return this.authRequest<ClientsResponse>(`/mini-app/trainer/clients/search?${search.toString()}`, { method: "GET" });
  }

  async getTrainerBlacklist(): Promise<ClientsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerBlacklist();
    }

    return this.authRequest<ClientsResponse>("/mini-app/trainer/clients/blacklist", { method: "GET" });
  }

  async addTrainerBlacklist(payload: { clientId: string; reason: string }): Promise<{ status: "added" | "already_blacklisted"; client: ClientProfile }> {
    if (this.shouldUsePreview()) {
      return this.preview.addTrainerBlacklist(payload);
    }

    return this.authRequest<{ status: "added" | "already_blacklisted"; client: ClientProfile }>("/mini-app/trainer/clients/blacklist/add", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async removeTrainerBlacklist(payload: { clientId: string }): Promise<{ status: "removed" | "already_removed"; client: ClientProfile }> {
    if (this.shouldUsePreview()) {
      return this.preview.removeTrainerBlacklist(payload);
    }

    return this.authRequest<{ status: "removed" | "already_removed"; client: ClientProfile }>("/mini-app/trainer/clients/blacklist/remove", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTrainerNoSlotRequests(status?: NoSlotRequestStatusType): Promise<NoSlotRequestsResponse> {
    if (this.shouldUsePreview()) {
      return this.preview.getTrainerNoSlotRequests(status);
    }

    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.authRequest<NoSlotRequestsResponse>(`/mini-app/trainer/no-slot-requests${suffix}`, { method: "GET" });
  }

  async updateTrainerNoSlotRequest(payload: {
    requestId: string;
    status: NoSlotRequestStatusType;
    trainerComment?: string | null;
  }): Promise<{ status: "updated"; request: NoSlotRequestDto }> {
    if (this.shouldUsePreview()) {
      return this.preview.updateTrainerNoSlotRequest(payload);
    }

    return this.authRequest<{ status: "updated"; request: NoSlotRequestDto }>("/mini-app/trainer/no-slot-requests/update", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async exportTrainerData(params?: { from?: string; to?: string }): Promise<Blob> {
    if (this.shouldUsePreview()) {
      return this.preview.exportTrainerData();
    }

    const search = new URLSearchParams();
    if (params?.from) {
      search.set("from", params.from);
    }
    if (params?.to) {
      search.set("to", params.to);
    }

    const suffix = search.toString() ? `?${search.toString()}` : "";
    const response = await fetch(`${this.baseUrl}/mini-app/trainer/export${suffix}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.requireToken()}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Mini App API responded with status ${response.status}`);
    }

    return response.blob();
  }

  private requireToken(): string {
    if (!this.token) {
      throw new Error("Нет активной mini app сессии");
    }

    return this.token;
  }

  private async authRequest<T>(path: string, options: RequestInit): Promise<T> {
    return this.request<T>(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.requireToken()}`,
        ...(options.headers ?? {}),
      },
    });
  }

  private async request<T>(path: string, options: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Mini App API responded with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  private shouldUsePreview(): boolean {
    return this.preview.isEnabled() && isLocalPreviewEnvironment();
  }
}
