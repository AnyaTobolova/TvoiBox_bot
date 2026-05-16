export interface NoSlotRequestDto {
  id: string;
  status: "NEW" | "REVIEWED" | "ARCHIVED";
  preferredDays: string[];
  preferredTime: string | null;
  clientComment: string | null;
  trainerComment: string | null;
  createdAt: string;
  client: {
    id: string;
    telegramId: string;
    fullName: string;
    username: string | null;
    phone: string | null;
  };
}

interface CreateNoSlotRequestPayload {
  telegramId: string;
  preferredDays: string[];
  preferredTime?: string | null;
  clientComment?: string | null;
}

interface CreateNoSlotRequestResponse {
  status: "created";
  request: NoSlotRequestDto;
}

export class NoSlotRequestsApiService {
  constructor(private readonly apiBaseUrl: string) {}

  async createRequest(payload: CreateNoSlotRequestPayload): Promise<CreateNoSlotRequestResponse> {
    const response = await fetch(`${this.apiBaseUrl}/no-slot-requests/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NoSlotRequests API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as CreateNoSlotRequestResponse;
  }
}

