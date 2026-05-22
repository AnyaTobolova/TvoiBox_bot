export interface ClientProfile {
  id: string;
  telegramId: string;
  username: string | null;
  fullName: string;
  phone: string | null;
  consentAcceptedAt: string | null;
  isBlacklisted: boolean;
  blacklistReason?: string | null;
  blacklistedAt?: string | null;
}

export interface FindClientResponse {
  found: boolean;
  client?: ClientProfile;
}

interface RegisterClientPayload {
  telegramId: string;
  username: string | null;
  fullName: string;
  phone: string | null;
  consentAccepted: boolean;
}

interface RegisterClientResponse {
  status: "created" | "already_registered";
  client: ClientProfile;
}

interface BlacklistResponse {
  status: "ok";
  items: ClientProfile[];
}

interface RemoveFromBlacklistResponse {
  status: "removed" | "already_removed";
  client: ClientProfile;
}

interface SearchClientsResponse {
  status: "ok";
  items: ClientProfile[];
}

export class ClientsApiService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trainerTelegramId?: string,
  ) {}

  async findByTelegramId(telegramId: string): Promise<FindClientResponse> {
    const response = await fetch(`${this.apiBaseUrl}/clients/telegram/${encodeURIComponent(telegramId)}`);

    if (!response.ok) {
      throw new Error(`Clients API responded with status ${response.status}`);
    }

    return (await response.json()) as FindClientResponse;
  }

  async register(payload: RegisterClientPayload): Promise<RegisterClientResponse> {
    const response = await fetch(`${this.apiBaseUrl}/clients/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Clients API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as RegisterClientResponse;
  }

  async getBlacklist(): Promise<BlacklistResponse> {
    if (!this.trainerTelegramId) {
      throw new Error("trainerTelegramId is not configured");
    }

    const query = new URLSearchParams({
      trainerTelegramId: this.trainerTelegramId,
    });

    const response = await fetch(`${this.apiBaseUrl}/clients/blacklist?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Clients API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as BlacklistResponse;
  }

  async removeFromBlacklist(clientId: string): Promise<RemoveFromBlacklistResponse> {
    if (!this.trainerTelegramId) {
      throw new Error("trainerTelegramId is not configured");
    }

    const response = await fetch(`${this.apiBaseUrl}/clients/blacklist/remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trainerTelegramId: this.trainerTelegramId,
        clientId,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Clients API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as RemoveFromBlacklistResponse;
  }

  async searchClients(queryText: string, limit = 10): Promise<SearchClientsResponse> {
    if (!this.trainerTelegramId) {
      throw new Error("trainerTelegramId is not configured");
    }

    const query = new URLSearchParams({
      trainerTelegramId: this.trainerTelegramId,
      q: queryText,
      limit: String(limit),
    });

    const response = await fetch(`${this.apiBaseUrl}/clients/search?${query.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Clients API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as SearchClientsResponse;
  }
}
