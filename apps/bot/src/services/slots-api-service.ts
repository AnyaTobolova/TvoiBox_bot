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

export interface ClosedPeriodItem {
  startAt: string;
  endAt: string;
  reason: string;
  closedSlotsCount: number;
}

interface ClosedPeriodsResponse {
  status: "ok";
  items: ClosedPeriodItem[];
}

interface CloseSlotsPayload {
  trainerTelegramId: string;
  startAt: string;
  endAt: string;
  reason: string;
}

interface ReopenSlotsPayload {
  trainerTelegramId: string;
  startAt: string;
  endAt: string;
}

interface OpenSlotsPayload {
  trainerTelegramId: string;
  startAt: string;
  endAt: string;
}

interface CloseSlotsResult {
  closed: number;
  skippedBooked: number;
  notFound: number;
}

interface ReopenSlotsResult {
  reopened: number;
}

interface OpenSlotsResult {
  created: number;
  reopened: number;
  alreadyOpen: number;
  skippedBooked: number;
}

export class SlotsApiService {
  constructor(private readonly apiBaseUrl: string) {}

  async getAvailableSlots(telegramId: string): Promise<AvailableSlot[]> {
    const query = new URLSearchParams({
      telegramId,
    });

    const response = await fetch(`${this.apiBaseUrl}/slots/available?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as AvailableSlot[];
  }

  async getClosureInfo(telegramId: string): Promise<SlotClosureInfo> {
    const query = new URLSearchParams({
      telegramId,
    });

    const response = await fetch(`${this.apiBaseUrl}/slots/closure-info?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as SlotClosureInfo;
  }

  async closeSlots(payload: CloseSlotsPayload): Promise<CloseSlotsResult> {
    const response = await fetch(`${this.apiBaseUrl}/slots/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as CloseSlotsResult;
  }

  async openSlots(payload: OpenSlotsPayload): Promise<OpenSlotsResult> {
    const response = await fetch(`${this.apiBaseUrl}/slots/open`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as OpenSlotsResult;
  }

  async reopenSlots(payload: ReopenSlotsPayload): Promise<ReopenSlotsResult> {
    const response = await fetch(`${this.apiBaseUrl}/slots/reopen`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as ReopenSlotsResult;
  }

  async getClosedPeriods(trainerTelegramId: string): Promise<ClosedPeriodsResponse> {
    const query = new URLSearchParams({
      trainerTelegramId,
    });

    const response = await fetch(`${this.apiBaseUrl}/slots/closed-periods?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as ClosedPeriodsResponse;
  }

  async getTrainerSlots(trainerTelegramId: string, from: string, to: string): Promise<AvailableSlot[]> {
    const query = new URLSearchParams({
      trainerTelegramId,
      from,
      to,
    });

    const response = await fetch(`${this.apiBaseUrl}/slots/trainer-grid?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Slots API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as AvailableSlot[];
  }
}
