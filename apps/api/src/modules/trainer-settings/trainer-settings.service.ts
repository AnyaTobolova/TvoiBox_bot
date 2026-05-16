import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../prisma/prisma.service";

export interface TrainerSettingsDto {
  bookingHorizonDays: number;
  sameDayBookingCutoff: number;
  updatedAt: string;
}

export interface GetTrainerSettingsInput {
  trainerTelegramId: string;
}

export interface UpdateTrainerSettingsInput {
  trainerTelegramId: string;
  bookingHorizonDays?: number;
  sameDayBookingCutoff?: number;
}

const MIN_BOOKING_HORIZON_DAYS = 1;
const MAX_BOOKING_HORIZON_DAYS = 60;
const MIN_SAME_DAY_CUTOFF_HOURS = 0;
const MAX_SAME_DAY_CUTOFF_HOURS = 23;

@Injectable()
export class TrainerSettingsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly appConfigService: AppConfigService,
  ) {}

  async getCurrent(input: GetTrainerSettingsInput): Promise<TrainerSettingsDto> {
    this.ensureTrainerAccess(input.trainerTelegramId);
    const settings = await this.ensureTrainerSettings();
    return this.toDto(settings);
  }

  async update(input: UpdateTrainerSettingsInput): Promise<TrainerSettingsDto> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const hasHorizon = typeof input.bookingHorizonDays !== "undefined";
    const hasCutoff = typeof input.sameDayBookingCutoff !== "undefined";
    if (!hasHorizon && !hasCutoff) {
      throw new BadRequestException("At least one setting must be provided");
    }

    const nextHorizon = hasHorizon ? this.parseHorizonDays(input.bookingHorizonDays) : undefined;
    const nextCutoff = hasCutoff ? this.parseSameDayCutoff(input.sameDayBookingCutoff) : undefined;
    const current = await this.ensureTrainerSettings();

    const updated = await this.prismaService.trainerSettings.update({
      where: { id: current.id },
      data: {
        bookingHorizonDays: nextHorizon,
        sameDayBookingCutoff: nextCutoff,
      },
    });

    return this.toDto(updated);
  }

  private parseHorizonDays(rawValue: number | undefined): number {
    if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
      throw new BadRequestException("bookingHorizonDays must be an integer");
    }

    if (rawValue < MIN_BOOKING_HORIZON_DAYS || rawValue > MAX_BOOKING_HORIZON_DAYS) {
      throw new BadRequestException(
        `bookingHorizonDays must be between ${MIN_BOOKING_HORIZON_DAYS} and ${MAX_BOOKING_HORIZON_DAYS}`,
      );
    }

    return rawValue;
  }

  private parseSameDayCutoff(rawValue: number | undefined): number {
    if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
      throw new BadRequestException("sameDayBookingCutoff must be an integer");
    }

    if (rawValue < MIN_SAME_DAY_CUTOFF_HOURS || rawValue > MAX_SAME_DAY_CUTOFF_HOURS) {
      throw new BadRequestException(
        `sameDayBookingCutoff must be between ${MIN_SAME_DAY_CUTOFF_HOURS} and ${MAX_SAME_DAY_CUTOFF_HOURS}`,
      );
    }

    return rawValue;
  }

  private ensureTrainerAccess(trainerTelegramId: string): void {
    if (trainerTelegramId.trim() !== this.appConfigService.values.trainerTelegramId) {
      throw new ForbiddenException("Only trainer can manage settings");
    }
  }

  private async ensureTrainerSettings() {
    const existing = await this.prismaService.trainerSettings.findFirst();
    if (existing) {
      return existing;
    }

    return this.prismaService.trainerSettings.create({
      data: {
        bookingHorizonDays: 14,
        sameDayBookingCutoff: 0,
      },
    });
  }

  private toDto(settings: {
    bookingHorizonDays: number;
    sameDayBookingCutoff: number;
    updatedAt: Date;
  }): TrainerSettingsDto {
    return {
      bookingHorizonDays: settings.bookingHorizonDays,
      sameDayBookingCutoff: settings.sameDayBookingCutoff,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}
