export interface TrainerSettingsDto {
  bookingHorizonDays: number;
  sameDayBookingCutoff: number;
  updatedAt: string;
}

interface GetTrainerSettingsResponse {
  status: "ok";
  settings: TrainerSettingsDto;
}

interface UpdateTrainerSettingsPayload {
  bookingHorizonDays?: number;
  sameDayBookingCutoff?: number;
}

interface UpdateTrainerSettingsResponse {
  status: "updated";
  settings: TrainerSettingsDto;
}

export class TrainerSettingsApiService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly trainerTelegramId: string,
  ) {}

  async getCurrent(): Promise<GetTrainerSettingsResponse> {
    const query = new URLSearchParams({
      trainerTelegramId: this.trainerTelegramId,
    });
    const response = await fetch(`${this.apiBaseUrl}/trainer-settings/current?${query.toString()}`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TrainerSettings API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as GetTrainerSettingsResponse;
  }

  async update(payload: UpdateTrainerSettingsPayload): Promise<UpdateTrainerSettingsResponse> {
    const response = await fetch(`${this.apiBaseUrl}/trainer-settings/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        trainerTelegramId: this.trainerTelegramId,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TrainerSettings API responded with status ${response.status}: ${body}`);
    }

    return (await response.json()) as UpdateTrainerSettingsResponse;
  }
}
