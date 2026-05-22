import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../prisma/prisma.service";

export interface TrainerSettingsDto {
  bookingHorizonDays: number;
  sameDayBookingCutoff: number;
  workingDays: string[];
  workdayStartHour: number;
  workdayEndHour: number;
  updatedAt: string;
}

export interface GetTrainerSettingsInput {
  trainerTelegramId: string;
}

export interface UpdateTrainerSettingsInput {
  trainerTelegramId: string;
  bookingHorizonDays?: number;
  sameDayBookingCutoff?: number;
  workingDays?: string[];
  workdayStartHour?: number;
  workdayEndHour?: number;
}

const MIN_BOOKING_HORIZON_DAYS = 1;
const MAX_BOOKING_HORIZON_DAYS = 60;
const MIN_SAME_DAY_CUTOFF_HOURS = 0;
const MAX_SAME_DAY_CUTOFF_HOURS = 23;
const MIN_WORKDAY_HOUR = 0;
const MAX_WORKDAY_START_HOUR = 23;
const MAX_WORKDAY_END_HOUR = 24;
const DEFAULT_WORKING_DAYS = ["monday", "wednesday", "friday"];
const ALLOWED_WORKING_DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

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

  async getPublicSettings(): Promise<TrainerSettingsDto> {
    const settings = await this.ensureTrainerSettings();
    return this.toDto(settings);
  }

  async update(input: UpdateTrainerSettingsInput): Promise<TrainerSettingsDto> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const hasHorizon = typeof input.bookingHorizonDays !== "undefined";
    const hasCutoff = typeof input.sameDayBookingCutoff !== "undefined";
    const hasWorkingDays = typeof input.workingDays !== "undefined";
    const hasWorkdayStartHour = typeof input.workdayStartHour !== "undefined";
    const hasWorkdayEndHour = typeof input.workdayEndHour !== "undefined";
    if (!hasHorizon && !hasCutoff && !hasWorkingDays && !hasWorkdayStartHour && !hasWorkdayEndHour) {
      throw new BadRequestException("At least one setting must be provided");
    }

    const nextHorizon = hasHorizon ? this.parseHorizonDays(input.bookingHorizonDays) : undefined;
    const nextCutoff = hasCutoff ? this.parseSameDayCutoff(input.sameDayBookingCutoff) : undefined;
    const nextWorkingDays = hasWorkingDays ? this.parseWorkingDays(input.workingDays) : undefined;
    const nextWorkdayStartHour = hasWorkdayStartHour ? this.parseWorkdayStartHour(input.workdayStartHour) : undefined;
    const nextWorkdayEndHour = hasWorkdayEndHour ? this.parseWorkdayEndHour(input.workdayEndHour) : undefined;
    const current = await this.ensureTrainerSettings();

    const effectiveStartHour = typeof nextWorkdayStartHour === "number"
      ? nextWorkdayStartHour
      : current.workdayStartHour;
    const effectiveEndHour = typeof nextWorkdayEndHour === "number"
      ? nextWorkdayEndHour
      : current.workdayEndHour;
    if (effectiveEndHour <= effectiveStartHour) {
      throw new BadRequestException("workdayEndHour must be greater than workdayStartHour");
    }

    const updated = await this.prismaService.trainerSettings.update({
      where: { id: current.id },
      data: {
        bookingHorizonDays: nextHorizon,
        sameDayBookingCutoff: nextCutoff,
        workingDays: nextWorkingDays,
        workdayStartHour: nextWorkdayStartHour,
        workdayEndHour: nextWorkdayEndHour,
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

  private parseWorkingDays(rawValue: string[] | undefined): string[] {
    if (!Array.isArray(rawValue)) {
      throw new BadRequestException("workingDays must be an array");
    }

    const normalized = rawValue
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
    const unique = [...new Set(normalized)];

    if (unique.length === 0) {
      throw new BadRequestException("At least one working day must be selected");
    }

    if (unique.some((item) => !ALLOWED_WORKING_DAYS.has(item))) {
      throw new BadRequestException("workingDays contains unsupported values");
    }

    return unique;
  }

  private parseWorkdayStartHour(rawValue: number | undefined): number {
    if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
      throw new BadRequestException("workdayStartHour must be an integer");
    }

    if (rawValue < MIN_WORKDAY_HOUR || rawValue > MAX_WORKDAY_START_HOUR) {
      throw new BadRequestException(`workdayStartHour must be between ${MIN_WORKDAY_HOUR} and ${MAX_WORKDAY_START_HOUR}`);
    }

    return rawValue;
  }

  private parseWorkdayEndHour(rawValue: number | undefined): number {
    if (typeof rawValue !== "number" || !Number.isInteger(rawValue)) {
      throw new BadRequestException("workdayEndHour must be an integer");
    }

    if (rawValue < 1 || rawValue > MAX_WORKDAY_END_HOUR) {
      throw new BadRequestException(`workdayEndHour must be between 1 and ${MAX_WORKDAY_END_HOUR}`);
    }

    return rawValue;
  }

  private ensureTrainerAccess(trainerTelegramId: string): void {
    const actorId = trainerTelegramId.trim();
    const allowed = new Set([
      this.appConfigService.values.trainerTelegramId,
      this.appConfigService.values.adminTelegramId,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException("Only trainer/admin can manage settings");
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
        workingDays: DEFAULT_WORKING_DAYS,
        workdayStartHour: 8,
        workdayEndHour: 22,
      },
    });
  }

  private toDto(settings: {
    bookingHorizonDays: number;
    sameDayBookingCutoff: number;
    workingDays: string[];
    workdayStartHour: number;
    workdayEndHour: number;
    updatedAt: Date;
  }): TrainerSettingsDto {
    return {
      bookingHorizonDays: settings.bookingHorizonDays,
      sameDayBookingCutoff: settings.sameDayBookingCutoff,
      workingDays: settings.workingDays,
      workdayStartHour: settings.workdayStartHour,
      workdayEndHour: settings.workdayEndHour,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}
