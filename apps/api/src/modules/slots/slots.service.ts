import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { BookingStatus, Prisma, SlotStatus, TrainingStatus } from "@prisma/client";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../prisma/prisma.service";

const SLOT_DURATION_MS = 60 * 60 * 1000;
const DAY_MS = 24 * SLOT_DURATION_MS;
const MOSCOW_TIME_ZONE = "Europe/Moscow";
export const VIRTUAL_SLOT_PREFIX = "virtual";

export interface OpenSlotsInput {
  trainerTelegramId: string;
  startAt: string;
  endAt?: string;
}

export interface CloseSlotsInput {
  trainerTelegramId: string;
  slotId?: string;
  startAt?: string;
  endAt?: string;
  reason?: string | null;
}

export interface GetAvailableSlotsInput {
  telegramId: string;
  from?: string;
  to?: string;
}

export interface GetTrainerSlotsInput {
  trainerTelegramId: string;
  from: string;
  to: string;
}

export interface SlotDto {
  id: string;
  startAt: string;
  endAt: string;
  status: SlotStatus;
}

export interface SlotClosureInfoDto {
  hasClosure: boolean;
  reason: string | null;
  closedFrom: string | null;
  closedUntil: string | null;
  closedSlotsCount: number;
}

export interface OpenSlotsResult {
  created: number;
  reopened: number;
  alreadyOpen: number;
  skippedBooked: number;
  slots: SlotDto[];
}

export interface CloseSlotsResult {
  closed: number;
  skippedBooked: number;
  notFound: number;
}

export interface ReopenSlotsResult {
  reopened: number;
}

export interface ClosedPeriodDto {
  startAt: string;
  endAt: string;
  reason: string;
  closedSlotsCount: number;
}

const moscowDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: MOSCOW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const moscowWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MOSCOW_TIME_ZONE,
  weekday: "long",
});

@Injectable()
export class SlotsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly appConfigService: AppConfigService,
  ) {}

  async openSlots(input: OpenSlotsInput): Promise<OpenSlotsResult> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const startAt = this.parseIsoDate("startAt", input.startAt);
    const endAt = input.endAt ? this.parseIsoDate("endAt", input.endAt) : new Date(startAt.getTime() + SLOT_DURATION_MS);
    const ranges = this.buildSlotRanges(startAt, endAt);

    let created = 0;
    let reopened = 0;
    let alreadyOpen = 0;
    let skippedBooked = 0;
    const slots: SlotDto[] = [];

    await this.prismaService.$transaction(async (transaction) => {
      for (const range of ranges) {
        const existing = await transaction.slot.findUnique({
          where: {
            startAt_endAt: {
              startAt: range.startAt,
              endAt: range.endAt,
            },
          },
        });

        if (!existing) {
          const createdSlot = await transaction.slot.create({
            data: {
              startAt: range.startAt,
              endAt: range.endAt,
              status: SlotStatus.OPEN,
            },
          });
          created += 1;
          slots.push(this.toSlotDto(createdSlot));
          continue;
        }

        if (existing.status === SlotStatus.BOOKED) {
          const hasActiveOccupation = await this.hasActiveOccupation(transaction, existing.id);
          if (hasActiveOccupation) {
            skippedBooked += 1;
            continue;
          }
        }

        if (existing.status === SlotStatus.OPEN) {
          alreadyOpen += 1;
          slots.push(this.toSlotDto(existing));
          continue;
        }

        const reopenedSlot = await transaction.slot.update({
          where: { id: existing.id },
          data: {
            status: SlotStatus.OPEN,
            isManuallyClosed: false,
            closureReason: null,
            heldUntil: null,
          },
        });
        reopened += 1;
        slots.push(this.toSlotDto(reopenedSlot));
      }
    });

    return {
      created,
      reopened,
      alreadyOpen,
      skippedBooked,
      slots,
    };
  }

  async closeSlots(input: CloseSlotsInput): Promise<CloseSlotsResult> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const reason = input.reason?.trim() || null;

    if (input.slotId) {
      const slotId = input.slotId.trim();
      if (!slotId) {
        throw new BadRequestException("slotId must not be empty");
      }

      const existing = await this.prismaService.slot.findUnique({
        where: { id: slotId },
      });

      if (!existing) {
        return {
          closed: 0,
          skippedBooked: 0,
          notFound: 1,
        };
      }

      if (existing.status === SlotStatus.BOOKED) {
        throw new ConflictException("Cannot close booked slot");
      }

      if (existing.status === SlotStatus.CLOSED && existing.isManuallyClosed) {
        return {
          closed: 0,
          skippedBooked: 0,
          notFound: 0,
        };
      }

      await this.prismaService.slot.update({
        where: { id: existing.id },
        data: {
          status: SlotStatus.CLOSED,
          isManuallyClosed: true,
          closureReason: reason,
          heldUntil: null,
        },
      });

      return {
        closed: 1,
        skippedBooked: 0,
        notFound: 0,
      };
    }

    if (!input.startAt || !input.endAt) {
      throw new BadRequestException("Provide either slotId or both startAt and endAt");
    }

    let startAt = this.parseIsoDate("startAt", input.startAt);
    let endAt = this.parseIsoDate("endAt", input.endAt);

    // Period closures from admin panel are date-based and must cover full Moscow days.
    if (reason) {
      const normalizedStartAt = this.getMoscowStartOfDay(startAt);
      const normalizedEndAt = this.toMoscowDayExclusiveEnd(endAt);
      startAt = normalizedStartAt;
      endAt = normalizedEndAt;
    }

    this.assertFullHourBoundary("startAt", startAt);
    this.assertFullHourBoundary("endAt", endAt);

    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException("endAt must be greater than startAt");
    }

    const ranges = this.buildSlotRanges(startAt, endAt);
    let closed = 0;
    let skippedBooked = 0;

    await this.prismaService.$transaction(async (transaction) => {
      for (const range of ranges) {
        const existing = await transaction.slot.findUnique({
          where: {
            startAt_endAt: {
              startAt: range.startAt,
              endAt: range.endAt,
            },
          },
        });

        if (!existing) {
          await transaction.slot.create({
            data: {
              startAt: range.startAt,
              endAt: range.endAt,
              status: SlotStatus.CLOSED,
              isManuallyClosed: true,
              closureReason: reason,
              heldUntil: null,
            },
          });
          closed += 1;
          continue;
        }

        if (existing.status === SlotStatus.BOOKED) {
          skippedBooked += 1;
          continue;
        }

        if (existing.status === SlotStatus.CLOSED && existing.isManuallyClosed) {
          continue;
        }

        await transaction.slot.update({
          where: { id: existing.id },
          data: {
            status: SlotStatus.CLOSED,
            isManuallyClosed: true,
            closureReason: reason,
            heldUntil: null,
          },
        });
        closed += 1;
      }
    });

    return {
      closed,
      skippedBooked,
      notFound: 0,
    };
  }

  async reopenSlots(input: OpenSlotsInput): Promise<ReopenSlotsResult> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const startAt = this.parseIsoDate("startAt", input.startAt);
    const endAt = input.endAt ? this.parseIsoDate("endAt", input.endAt) : new Date(startAt.getTime() + SLOT_DURATION_MS);
    this.assertFullHourBoundary("startAt", startAt);
    this.assertFullHourBoundary("endAt", endAt);
    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException("endAt must be greater than startAt");
    }
    const result = await this.prismaService.slot.updateMany({
      where: {
        startAt: {
          gte: startAt,
          lt: endAt,
        },
        status: SlotStatus.CLOSED,
        isManuallyClosed: true,
      },
      data: {
        status: SlotStatus.OPEN,
        isManuallyClosed: false,
        closureReason: null,
        heldUntil: null,
      },
    });

    return {
      reopened: result.count,
    };
  }

  private async hasActiveOccupation(transaction: Prisma.TransactionClient, slotId: string): Promise<boolean> {
    const [activeBooking, activeTraining] = await Promise.all([
      transaction.booking.findFirst({
        where: {
          slotId,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.RESCHEDULED],
          },
        },
        select: { id: true },
      }),
      transaction.training.findFirst({
        where: {
          slotId,
          status: {
            in: [TrainingStatus.SCHEDULED, TrainingStatus.RESCHEDULED],
          },
        },
        select: { id: true },
      }),
    ]);

    return Boolean(activeBooking || activeTraining);
  }

  async getAvailableSlots(input: GetAvailableSlotsInput): Promise<SlotDto[]> {
    const telegramId = input.telegramId.trim();
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    const client = await this.prismaService.client.findUnique({
      where: { telegramId },
    });

    if (!client) {
      throw new BadRequestException("Client is not registered");
    }

    const now = new Date();
    const settings = await this.ensureTrainerSettings();

    const defaultFrom = now;
    const defaultTo = this.getBookingHorizonExclusiveEnd(now, settings.bookingHorizonDays);

    const requestedFrom = input.from ? this.parseIsoDate("from", input.from) : defaultFrom;
    const requestedTo = input.to ? this.parseIsoDate("to", input.to) : defaultTo;

    if (requestedTo.getTime() <= requestedFrom.getTime()) {
      throw new BadRequestException("to must be greater than from");
    }

    const from = new Date(Math.max(requestedFrom.getTime(), defaultFrom.getTime()));
    const to = new Date(Math.min(requestedTo.getTime(), defaultTo.getTime()));

    if (to.getTime() <= from.getTime()) {
      return [];
    }

    const slotFrom = this.roundUpToFullHour(from);
    if (slotFrom.getTime() >= to.getTime()) {
      return [];
    }

    const explicitSlots = await this.prismaService.slot.findMany({
      where: {
        startAt: {
          gte: slotFrom,
          lt: to,
        },
      },
      orderBy: {
        startAt: "asc",
      },
    });

    const explicitSlotsByKey = new Map<string, (typeof explicitSlots)[number]>();
    for (const slot of explicitSlots) {
      explicitSlotsByKey.set(this.getSlotKey(slot.startAt, slot.endAt), slot);
    }

    const cutoffMs = settings.sameDayBookingCutoff * 60 * 60 * 1000;
    const cutoffMoment = new Date(now.getTime() + cutoffMs);
    const nowMoscowDateKey = this.getMoscowDateKey(now);

    const available: SlotDto[] = [];
    for (let cursor = slotFrom.getTime(); cursor < to.getTime(); cursor += SLOT_DURATION_MS) {
      const startAt = new Date(cursor);
      const endAt = new Date(cursor + SLOT_DURATION_MS);
      const key = this.getSlotKey(startAt, endAt);
      const explicit = explicitSlotsByKey.get(key);

      if (startAt.getTime() < now.getTime()) {
        continue;
      }

      if (!this.isWithinWorkingSchedule(startAt, settings)) {
        continue;
      }

      if (settings.sameDayBookingCutoff <= 0) {
        // no-op
      } else {
        const slotMoscowDateKey = this.getMoscowDateKey(startAt);
        if (slotMoscowDateKey === nowMoscowDateKey && startAt.getTime() < cutoffMoment.getTime()) {
          continue;
        }
      }

      if (!explicit) {
        continue;
      }

      if (explicit.status === SlotStatus.CLOSED || explicit.status === SlotStatus.HELD || explicit.status === SlotStatus.BOOKED) {
        continue;
      }

      if (explicit.status === SlotStatus.OPEN) {
        available.push(this.toSlotDto(explicit));
        continue;
      }
    }

    return available;
  }

  async getTrainerSlots(input: GetTrainerSlotsInput): Promise<SlotDto[]> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const from = this.parseIsoDate("from", input.from);
    const to = this.parseIsoDate("to", input.to);

    this.assertFullHourBoundary("from", from);
    this.assertFullHourBoundary("to", to);
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException("to must be greater than from");
    }

    const maxRangeMs = 31 * 24 * SLOT_DURATION_MS;
    if (to.getTime() - from.getTime() > maxRangeMs) {
      throw new BadRequestException("Range is too large");
    }

    const settings = await this.ensureTrainerSettings();
    const explicitSlots = await this.prismaService.slot.findMany({
      where: {
        startAt: {
          gte: from,
          lt: to,
        },
      },
      orderBy: {
        startAt: "asc",
      },
    });

    const explicitSlotsByKey = new Map<string, (typeof explicitSlots)[number]>();
    for (const slot of explicitSlots) {
      explicitSlotsByKey.set(this.getSlotKey(slot.startAt, slot.endAt), slot);
    }

    const result: SlotDto[] = [];
    for (let cursor = from.getTime(); cursor < to.getTime(); cursor += SLOT_DURATION_MS) {
      const startAt = new Date(cursor);
      const endAt = new Date(cursor + SLOT_DURATION_MS);
      const key = this.getSlotKey(startAt, endAt);
      const explicit = explicitSlotsByKey.get(key);

      if (!this.isWithinWorkingSchedule(startAt, settings)) {
        continue;
      }

      if (explicit) {
        result.push({
          id: explicit.id,
          startAt: explicit.startAt.toISOString(),
          endAt: explicit.endAt.toISOString(),
          status: explicit.status,
        });
        continue;
      }

      result.push({
        id: this.toVirtualSlotId(startAt, endAt),
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        status: SlotStatus.CLOSED,
      });
    }

    return result;
  }

  async getClientClosureInfo(input: GetAvailableSlotsInput): Promise<SlotClosureInfoDto> {
    const telegramId = input.telegramId.trim();
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    const client = await this.prismaService.client.findUnique({
      where: { telegramId },
    });
    if (!client) {
      throw new BadRequestException("Client is not registered");
    }

    const now = new Date();
    const settings = await this.ensureTrainerSettings();
    const defaultTo = this.getBookingHorizonExclusiveEnd(now, settings.bookingHorizonDays);
    const from = this.roundUpToFullHour(now);
    const to = defaultTo;

    if (to.getTime() <= from.getTime()) {
      return {
        hasClosure: false,
        reason: null,
        closedFrom: null,
        closedUntil: null,
        closedSlotsCount: 0,
      };
    }

    const manualClosedSlots = await this.prismaService.slot.findMany({
      where: {
        isManuallyClosed: true,
        status: SlotStatus.CLOSED,
        closureReason: {
          not: null,
        },
        startAt: {
          gte: from,
          lt: to,
        },
      },
      orderBy: {
        startAt: "asc",
      },
    });

    if (manualClosedSlots.length === 0) {
      return {
        hasClosure: false,
        reason: null,
        closedFrom: null,
        closedUntil: null,
        closedSlotsCount: 0,
      };
    }

    const latestByUpdatedAt = [...manualClosedSlots].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];
    const reason = latestByUpdatedAt.closureReason?.trim() || null;
    const closedFrom = manualClosedSlots[0].startAt.toISOString();
    const closedUntil = manualClosedSlots[manualClosedSlots.length - 1].endAt.toISOString();

    return {
      hasClosure: Boolean(reason),
      reason,
      closedFrom,
      closedUntil,
      closedSlotsCount: manualClosedSlots.length,
    };
  }

  async listClosedPeriods(trainerTelegramId: string): Promise<ClosedPeriodDto[]> {
    this.ensureTrainerAccess(trainerTelegramId);

    const now = new Date();
    const settings = await this.ensureTrainerSettings();
    const from = this.roundUpToFullHour(now);
    const to = this.getBookingHorizonExclusiveEnd(now, settings.bookingHorizonDays);

    const closedSlots = await this.prismaService.slot.findMany({
      where: {
        isManuallyClosed: true,
        status: SlotStatus.CLOSED,
        closureReason: {
          not: null,
        },
        startAt: {
          gte: from,
          lt: to,
        },
      },
      orderBy: {
        startAt: "asc",
      },
    });

    if (closedSlots.length === 0) {
      return [];
    }

    const periods: Array<{
      startAt: Date;
      endAt: Date;
      reason: string;
      closedSlotsCount: number;
    }> = [];

    for (const slot of closedSlots) {
      const reason = slot.closureReason?.trim() || "без причины";
      const last = periods[periods.length - 1];
      if (
        last
        && last.endAt.getTime() === slot.startAt.getTime()
        && last.reason === reason
      ) {
        last.endAt = slot.endAt;
        last.closedSlotsCount += 1;
        continue;
      }

      periods.push({
        startAt: slot.startAt,
        endAt: slot.endAt,
        reason,
        closedSlotsCount: 1,
      });
    }

    return periods.map((period) => ({
      startAt: period.startAt.toISOString(),
      endAt: period.endAt.toISOString(),
      reason: period.reason,
      closedSlotsCount: period.closedSlotsCount,
    }));
  }

  private ensureTrainerAccess(trainerTelegramId: string): void {
    const actorId = trainerTelegramId.trim();
    const allowed = new Set([
      this.appConfigService.values.trainerTelegramId,
      this.appConfigService.values.adminTelegramId,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException("Only trainer/admin can manage slots");
    }
  }

  private parseIsoDate(fieldName: string, rawValue: string): Date {
    const value = rawValue.trim();
    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`);
    }

    return date;
  }

  private buildSlotRanges(startAt: Date, endAt: Date): Array<{ startAt: Date; endAt: Date }> {
    this.assertFullHourBoundary("startAt", startAt);
    this.assertFullHourBoundary("endAt", endAt);

    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException("endAt must be greater than startAt");
    }

    const duration = endAt.getTime() - startAt.getTime();
    if (duration % SLOT_DURATION_MS !== 0) {
      throw new BadRequestException("Range must be split into 60-minute slots");
    }

    const result: Array<{ startAt: Date; endAt: Date }> = [];
    let cursor = startAt.getTime();

    while (cursor < endAt.getTime()) {
      result.push({
        startAt: new Date(cursor),
        endAt: new Date(cursor + SLOT_DURATION_MS),
      });
      cursor += SLOT_DURATION_MS;
    }

    return result;
  }

  private assertFullHourBoundary(fieldName: string, date: Date): void {
    if (
      date.getUTCMinutes() !== 0 ||
      date.getUTCSeconds() !== 0 ||
      date.getUTCMilliseconds() !== 0
    ) {
      throw new BadRequestException(`${fieldName} must be on full hour boundary`);
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
        workingDays: ["monday", "wednesday", "friday"],
        workdayStartHour: 8,
        workdayEndHour: 22,
      },
    });
  }

  private isWithinWorkingSchedule(
    date: Date,
    settings: {
      workingDays: string[];
      workdayStartHour: number;
      workdayEndHour: number;
    },
  ): boolean {
    const weekday = moscowWeekdayFormatter.format(date).toLowerCase();
    if (!settings.workingDays.includes(weekday)) {
      return false;
    }

    const localHour = this.getMoscowHour(date);
    return localHour >= settings.workdayStartHour && localHour < settings.workdayEndHour;
  }

  private getMoscowHour(date: Date): number {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: MOSCOW_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);

    return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  }

  private getMoscowDateKey(date: Date): string {
    const parts = moscowDateFormatter.formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      return "";
    }

    return `${year}-${month}-${day}`;
  }

  private roundUpToFullHour(date: Date): Date {
    const rounded = new Date(date);
    rounded.setUTCMinutes(0, 0, 0);
    if (rounded.getTime() < date.getTime()) {
      rounded.setUTCHours(rounded.getUTCHours() + 1);
    }

    return rounded;
  }

  private getBookingHorizonExclusiveEnd(now: Date, bookingHorizonDays: number): Date {
    const safeDays = Number.isFinite(bookingHorizonDays) && bookingHorizonDays > 0
      ? Math.trunc(bookingHorizonDays)
      : 14;

    return new Date(this.getMoscowStartOfDay(now).getTime() + (safeDays + 1) * DAY_MS);
  }

  private getSlotKey(startAt: Date, endAt: Date): string {
    return `${startAt.toISOString()}|${endAt.toISOString()}`;
  }

  private toVirtualSlotId(startAt: Date, endAt: Date): string {
    return `${VIRTUAL_SLOT_PREFIX}|${startAt.getTime()}`;
  }

  private toSlotDto(slot: {
    id: string;
    startAt: Date;
    endAt: Date;
    status: SlotStatus;
  }): SlotDto {
    return {
      id: slot.id,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      status: slot.status,
    };
  }

  private getMoscowStartOfDay(date: Date): Date {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: MOSCOW_TIME_ZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(date);

    const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
    const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
    const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");

    return new Date(Date.UTC(year, month - 1, day, -3, 0, 0, 0));
  }

  private toMoscowDayExclusiveEnd(date: Date): Date {
    const startOfDay = this.getMoscowStartOfDay(date);
    if (startOfDay.getTime() === date.getTime()) {
      return startOfDay;
    }

    return new Date(startOfDay.getTime() + 24 * SLOT_DURATION_MS);
  }
}
