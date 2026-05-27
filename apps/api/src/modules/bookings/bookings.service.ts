import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BookingStatus, Prisma, SlotStatus, SyncOperation, SyncStatus, TrainingStatus } from "@prisma/client";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../prisma/prisma.service";
import { GoogleCalendarService } from "../google-calendar/google-calendar.service";
import { TelegramNotificationsService } from "../telegram-notifications/telegram-notifications.service";
import { VIRTUAL_SLOT_PREFIX } from "../slots/slots.service";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MOSCOW_OFFSET_MS = 3 * HOUR_MS;
type PrismaTransactionClient = Prisma.TransactionClient;

const moscowDateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export interface CreateBookingRequestInput {
  telegramId: string;
  slotId: string;
  clientComment?: string | null;
}

export interface BookingRequestResult {
  status: "created";
  booking: {
    id: string;
    slotId: string;
    status: BookingStatus;
    expiresAt: string;
    startAt: string;
    endAt: string;
  };
}

export interface GetPendingBookingsInput {
  trainerTelegramId: string;
}

export interface GetBookingDetailsInput {
  trainerTelegramId: string;
  bookingId: string;
}

export interface ConfirmBookingInput {
  trainerTelegramId: string;
  bookingId: string;
}

export interface RejectBookingInput {
  trainerTelegramId: string;
  bookingId: string;
  trainerComment: string;
}

export interface ProposeBookingTimeInput {
  trainerTelegramId: string;
  bookingId: string;
  proposedStartAt: string;
  trainerComment: string;
}

export interface CancelConfirmedTrainingInput {
  trainerTelegramId: string;
  bookingId: string;
  trainerComment: string;
}

export interface RescheduleConfirmedTrainingInput {
  trainerTelegramId: string;
  bookingId: string;
  newStartAt: string;
  trainerComment: string;
}

export interface ForceCloseBookingInput {
  trainerTelegramId: string;
  bookingId: string;
  trainerComment?: string;
}

export interface ArchiveBookingByTrainerInput {
  trainerTelegramId: string;
  bookingId: string;
}

export interface ResyncBookingCalendarInput {
  trainerTelegramId: string;
  bookingId: string;
}

export interface ClientProposalDecisionInput {
  telegramId: string;
  bookingId: string;
  decisionNote?: string;
}

export interface GetClientTrainingsInput {
  telegramId: string;
}

export interface ClientCancelTrainingInput {
  telegramId: string;
  bookingId: string;
  clientComment?: string;
}

export interface ClientRescheduleTrainingInput {
  telegramId: string;
  bookingId: string;
  targetSlotId: string;
  clientComment?: string;
}

export interface ClientArchiveTrainingInput {
  telegramId: string;
  bookingId: string;
}

export interface PendingBookingDto {
  id: string;
  status: BookingStatus;
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
    status: SlotStatus;
  };
}

export interface PendingBookingsResult {
  status: "ok";
  items: PendingBookingDto[];
}

export interface BookingActionResult {
  status: "confirmed" | "rejected" | "proposed" | "cancelled" | "rescheduled" | "resynced" | "archived";
  booking: PendingBookingDto;
}

export interface ClientTrainingDto {
  bookingId: string;
  bookingStatus: BookingStatus;
  trainingStatus: TrainingStatus | null;
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

export interface ClientTrainingsResult {
  status: "ok";
  items: ClientTrainingDto[];
}

export interface ClientTrainingCalendarFileResult {
  filename: string;
  content: string;
}

export interface GetTrainerTrainingsInput {
  trainerTelegramId: string;
  from?: string;
  to?: string;
}

export interface TrainerTrainingDto {
  bookingId: string;
  trainingId: string;
  bookingStatus: BookingStatus;
  trainingStatus: TrainingStatus;
  startAt: string;
  endAt: string;
  clientCalendarIcsUrl: string | null;
  trainerComment: string | null;
  clientComment: string | null;
  client: {
    id: string;
    telegramId: string;
    fullName: string;
    username: string | null;
    phone: string | null;
    note: string | null;
    isBlacklisted: boolean;
  };
  canCancel: boolean;
  canReschedule: boolean;
  canResyncCalendar: boolean;
}

export interface TrainerTrainingsResult {
  status: "ok";
  items: TrainerTrainingDto[];
}

interface RescheduledBookingWithRelations {
  id: string;
  clientId: string;
  slotId: string;
  status: BookingStatus;
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
    startAt: Date;
    endAt: Date;
    status: SlotStatus;
  };
  training: {
    id: string;
    status: TrainingStatus;
    slotId: string;
    calendarEventId: string | null;
  } | null;
}

interface ConfirmedClientBookingWithRelations {
  id: string;
  clientId: string;
  slotId: string;
  status: BookingStatus;
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
    startAt: Date;
    endAt: Date;
    status: SlotStatus;
  };
  training: {
    id: string;
    status: TrainingStatus;
    slotId: string;
    calendarEventId: string | null;
  } | null;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly appConfigService: AppConfigService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly telegramNotificationsService: TelegramNotificationsService,
  ) {}

  async createBookingRequest(input: CreateBookingRequestInput): Promise<BookingRequestResult> {
    const telegramId = input.telegramId.trim();
    const slotId = input.slotId.trim();
    const clientComment = input.clientComment?.trim() || null;

    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    if (!slotId) {
      throw new BadRequestException("slotId is required");
    }

    const now = new Date();

    const result = await this.prismaService.$transaction(async (transaction) => {
      const client = await transaction.client.findUnique({
        where: { telegramId },
      });

      if (!client) {
        throw new BadRequestException("Client is not registered");
      }

      if (client.isBlacklisted) {
        throw new ForbiddenException("Client is blacklisted");
      }

      const slot = await this.resolveSlotForBooking(transaction, slotId);

      await this.releaseExpiredHoldForSlot(transaction, slot, now);

      const freshSlot = await transaction.slot.findUnique({
        where: { id: slot.id },
      });

      if (!freshSlot) {
        throw new BadRequestException("Slot not found");
      }

      if (freshSlot.status !== SlotStatus.OPEN) {
        throw new ConflictException("Slot is not available");
      }

      const settings = await this.ensureTrainerSettings(transaction);
      this.assertSlotWithinBookingRules(
        freshSlot.startAt,
        now,
        settings.bookingHorizonDays,
        settings.sameDayBookingCutoff,
      );

      const expiresAt = this.getEndOfMoscowDay(now);

      const holdResult = await transaction.slot.updateMany({
        where: {
          id: freshSlot.id,
          status: SlotStatus.OPEN,
        },
        data: {
          status: SlotStatus.HELD,
          heldUntil: expiresAt,
        },
      });

      if (holdResult.count !== 1) {
        throw new ConflictException("Slot is no longer available");
      }

      const booking = await transaction.booking.create({
        data: {
          clientId: client.id,
          slotId: freshSlot.id,
          status: BookingStatus.PENDING,
          clientComment,
          expiresAt,
        },
      });

      return {
        status: "created" as const,
        booking: {
          id: booking.id,
          slotId: booking.slotId,
          status: booking.status,
          expiresAt: booking.expiresAt.toISOString(),
          startAt: freshSlot.startAt.toISOString(),
          endAt: freshSlot.endAt.toISOString(),
        },
      };
    });

    const bookingDetails = await this.prismaService.booking.findUnique({
      where: { id: result.booking.id },
      include: {
        client: true,
        slot: true,
      },
    });

    if (bookingDetails) {
      await this.telegramNotificationsService.notifyTrainerAboutBookingRequest({
        bookingId: bookingDetails.id,
        client: {
          fullName: bookingDetails.client.fullName,
          telegramId: bookingDetails.client.telegramId,
          username: bookingDetails.client.username,
          phone: bookingDetails.client.phone,
        },
        startAt: bookingDetails.slot.startAt.toISOString(),
        clientComment,
      });
    }

    return result;
  }

  async getPendingBookings(input: GetPendingBookingsInput): Promise<PendingBookingsResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const now = new Date();
    await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);
    });

    const bookings = await this.prismaService.booking.findMany({
      include: {
        client: true,
        slot: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });

    const archivedRows = await this.prismaService.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "bookings"
      WHERE "trainerArchivedAt" IS NOT NULL
    `;
    const archivedIds = new Set(archivedRows.map((row) => row.id));

    const sorted = bookings.filter((booking) => !archivedIds.has(booking.id)).sort((left, right) => {
      const leftPriority = this.getBookingStatusPriority(left.status);
      const rightPriority = this.getBookingStatusPriority(right.status);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      const leftStart = left.slot.startAt.getTime();
      const rightStart = right.slot.startAt.getTime();
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      return right.createdAt.getTime() - left.createdAt.getTime();
    });

    return {
      status: "ok",
      items: sorted.map((booking) => this.toPendingBookingDto(booking)),
    };
  }

  async getBookingDetails(input: GetBookingDetailsInput): Promise<PendingBookingDto> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();

    const result = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          slot: true,
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      return this.toPendingBookingDto(booking);
    });

    return result;
  }

  async archiveBookingByTrainer(input: ArchiveBookingByTrainerInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          slot: true,
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      const archivedRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "bookings"
        WHERE "id" = ${booking.id}
          AND "trainerArchivedAt" IS NOT NULL
      `;

        if (archivedRows.length > 0) {
          return {
            status: "archived" as const,
            booking: this.toPendingBookingDto(booking),
          };
        }

      await transaction.$executeRaw`
        UPDATE "bookings"
        SET "trainerArchivedAt" = ${now}
        WHERE "id" = ${booking.id}
      `;

      return {
        status: "archived" as const,
        booking: this.toPendingBookingDto(booking),
      };
    });

    return result;
  }

  async getClientTrainings(input: GetClientTrainingsInput): Promise<ClientTrainingsResult> {
    const telegramId = input.telegramId.trim();
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    const now = new Date();

    const result: ClientTrainingsResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const client = await transaction.client.findUnique({
        where: { telegramId },
        select: { id: true },
      });
      if (!client) {
        throw new BadRequestException("Client is not registered");
      }

      const bookings = await transaction.booking.findMany({
        where: {
          clientId: client.id,
        },
        include: {
          slot: true,
          training: {
            select: {
              status: true,
              clientCalendarIcsUrl: true,
            },
          },
        },
        orderBy: {
          slot: {
            startAt: "desc",
          },
        },
        take: 100,
      });

      const archivedRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "bookings"
        WHERE "clientId" = ${client.id}
          AND "clientArchivedAt" IS NOT NULL
      `;
      const archivedIds = new Set(archivedRows.map((row) => row.id));

      const items = bookings
        .filter((booking) => !archivedIds.has(booking.id))
        .map((booking) => {
        const isFuture = booking.slot.startAt.getTime() > now.getTime();
        const trainingCancelled = booking.training?.status === TrainingStatus.CANCELLED;
        const hasTrainerProposal = booking.status === BookingStatus.RESCHEDULED
          && this.extractProposedStartAtFromTrainerComment(booking.trainerComment) !== null;
        const isAwaitingTrainerDecision = booking.status === BookingStatus.PENDING
          || (booking.status === BookingStatus.RESCHEDULED && !hasTrainerProposal);
        const canManageConfirmed = booking.status === BookingStatus.CONFIRMED && isFuture && !trainingCancelled;
        const canCancelPendingRequest = isFuture
          && (booking.status === BookingStatus.PENDING || (booking.status === BookingStatus.RESCHEDULED && !hasTrainerProposal));
        const canDelete = !isAwaitingTrainerDecision;

        return {
          bookingId: booking.id,
          bookingStatus: booking.status,
          trainingStatus: booking.training?.status ?? null,
          startAt: booking.slot.startAt.toISOString(),
          endAt: booking.slot.endAt.toISOString(),
          clientCalendarIcsUrl: booking.training?.clientCalendarIcsUrl ?? null,
          trainerComment: booking.trainerComment,
          clientComment: booking.clientComment,
          isAwaitingTrainerDecision,
          hasTrainerProposal,
          canCancel: canManageConfirmed || canCancelPendingRequest,
          canReschedule: canManageConfirmed,
          canDelete,
        };
        })
        .sort((left, right) => {
          const leftIsFuture = new Date(left.endAt).getTime() > now.getTime();
          const rightIsFuture = new Date(right.endAt).getTime() > now.getTime();

          if (leftIsFuture !== rightIsFuture) {
            return leftIsFuture ? -1 : 1;
          }

          if (left.isAwaitingTrainerDecision !== right.isAwaitingTrainerDecision) {
            return left.isAwaitingTrainerDecision ? -1 : 1;
          }

          if (left.hasTrainerProposal !== right.hasTrainerProposal) {
            return left.hasTrainerProposal ? -1 : 1;
          }

          const leftStart = new Date(left.startAt).getTime();
          const rightStart = new Date(right.startAt).getTime();

          return leftIsFuture ? leftStart - rightStart : rightStart - leftStart;
        });

      return {
        status: "ok" as const,
        items,
      };
    });

    return result;
  }

  async getTrainerTrainings(input: GetTrainerTrainingsInput): Promise<TrainerTrainingsResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const now = new Date();
    const from = input.from?.trim() ? this.parseIsoDate("from", input.from) : now;
    const to = input.to?.trim() ? this.parseIsoDate("to", input.to) : new Date(from.getTime() + 31 * DAY_MS);

    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException("to must be greater than from");
    }

    if (to.getTime() - from.getTime() > 93 * DAY_MS) {
      throw new BadRequestException("Range is too large");
    }

    const result: TrainerTrainingsResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

        const bookings = await transaction.booking.findMany({
          where: {
            status: {
              in: [BookingStatus.CONFIRMED, BookingStatus.RESCHEDULED, BookingStatus.CANCELLED],
            },
            trainerArchivedAt: null,
            slot: {
              startAt: {
                gte: from,
              lt: to,
            },
          },
          training: {
            isNot: null,
          },
        },
        include: {
          client: true,
          slot: true,
          training: true,
        },
        orderBy: {
          slot: {
            startAt: "asc",
          },
        },
        take: 200,
      });

        return {
          status: "ok" as const,
          items: bookings
            .filter((booking) => booking.training)
            .map((booking) => {
            const isFuture = booking.slot.startAt.getTime() > now.getTime();
            return {
              bookingId: booking.id,
              trainingId: booking.training!.id,
              bookingStatus: booking.status,
              trainingStatus: booking.training!.status,
              startAt: booking.slot.startAt.toISOString(),
              endAt: booking.slot.endAt.toISOString(),
              clientCalendarIcsUrl: booking.training!.clientCalendarIcsUrl ?? null,
              trainerComment: booking.trainerComment,
              clientComment: booking.clientComment,
              client: {
                id: booking.client.id,
                telegramId: booking.client.telegramId,
                fullName: booking.client.fullName,
                username: booking.client.username,
                phone: booking.client.phone,
                note: booking.client.note ?? null,
                isBlacklisted: booking.client.isBlacklisted,
              },
              canCancel: isFuture,
              canReschedule: isFuture,
              canResyncCalendar: Boolean(booking.training?.id),
            };
          }),
      };
    });

    return result;
  }

  async archiveTrainingByClient(input: ClientArchiveTrainingInput): Promise<BookingActionResult> {
    const telegramId = input.telegramId.trim();
    const bookingId = input.bookingId.trim();
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await transaction.booking.findFirst({
        where: {
          id: bookingId,
          client: {
            telegramId,
          },
        },
        include: {
          client: true,
          slot: true,
          training: {
            select: {
              status: true,
            },
          },
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      const archivedRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "bookings"
        WHERE "id" = ${booking.id}
          AND "clientArchivedAt" IS NOT NULL
      `;
      if (archivedRows.length > 0) {
        throw new ConflictException("Booking is already archived");
      }

      await transaction.$executeRaw`
        UPDATE "bookings"
        SET "clientArchivedAt" = ${now}
        WHERE "id" = ${booking.id}
      `;

      return {
        status: "archived" as const,
        booking: this.toPendingBookingDto(booking),
      };
    });

    return result;
  }

  async cancelTrainingByClient(input: ClientCancelTrainingInput): Promise<BookingActionResult> {
    const telegramId = input.telegramId.trim();
    const bookingId = input.bookingId.trim();
    const comment = input.clientComment?.trim() ?? "";
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();
    const booking = await this.prismaService.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
        training: {
          select: {
            id: true,
            status: true,
            slotId: true,
            calendarEventId: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.client.telegramId !== telegramId) {
      throw new ForbiddenException("Booking does not belong to this client");
    }

    if (booking.status === BookingStatus.PENDING) {
      const result = await this.prismaService.$transaction(async (transaction) => {
        await this.releaseExpiredPendingBookings(transaction, now);
        const freshBooking = await transaction.booking.findUnique({
          where: { id: bookingId },
          include: {
            client: true,
            slot: true,
          },
        });

        if (!freshBooking || freshBooking.status !== BookingStatus.PENDING) {
          throw new ConflictException("Booking request is no longer active");
        }

        const updatedBooking = await transaction.booking.update({
          where: { id: freshBooking.id },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
            clientComment: this.appendClientActionComment(freshBooking.clientComment, "Клиент отменил заявку", comment),
          },
          include: {
            client: true,
            slot: true,
          },
        });

        await this.releaseHeldSlot(transaction, freshBooking.slotId);

        return {
          status: "cancelled" as const,
          booking: this.toPendingBookingDto(updatedBooking),
        };
      });

      await this.notifyTrainerClientCancellation(result.booking);

      return result;
    }

    const hasTrainerProposal = booking.status === BookingStatus.RESCHEDULED
      && this.extractProposedStartAtFromTrainerComment(booking.trainerComment) !== null;

    if (booking.status === BookingStatus.RESCHEDULED && booking.training && !hasTrainerProposal) {
      const result = await this.prismaService.$transaction(async (transaction) => {
        const freshBooking = await transaction.booking.findUnique({
          where: { id: bookingId },
          include: {
            client: true,
            slot: true,
            training: {
              select: {
                slotId: true,
              },
            },
          },
        });

        if (
          !freshBooking
          || freshBooking.client.telegramId !== telegramId
          || freshBooking.status !== BookingStatus.RESCHEDULED
          || !freshBooking.training
        ) {
          throw new ConflictException("Reschedule request is no longer active");
        }

        const requestedSlotId = freshBooking.slotId;
        const originalSlotId = freshBooking.training.slotId;
        const originalSlot = await transaction.slot.findUnique({
          where: { id: originalSlotId },
        });

        if (!originalSlot) {
          throw new ConflictException("Original training slot not found");
        }

        const updatedBooking = await transaction.booking.update({
          where: { id: freshBooking.id },
          data: {
            slotId: originalSlotId,
            status: BookingStatus.CONFIRMED,
            clientComment: this.appendClientActionComment(
              freshBooking.clientComment,
              "Клиент отменил запрос на перенос",
              comment,
            ),
          },
          include: {
            client: true,
            slot: true,
          },
        });

        await transaction.slot.updateMany({
          where: {
            id: requestedSlotId,
            status: SlotStatus.HELD,
          },
          data: {
            status: SlotStatus.OPEN,
            heldUntil: null,
          },
        });

        return {
          status: "confirmed" as const,
          booking: this.toPendingBookingDto(updatedBooking),
        };
      });

      await this.notifyTrainerClientCancellation(result.booking);

      return result;
    }

    const confirmedBooking = await this.prismaService.$transaction(async (transaction) => {
      return this.getConfirmedBookingForClientOrThrow(transaction, bookingId, telegramId);
    });
    const training = confirmedBooking.training;
    if (!training) {
      throw new ConflictException("Training record not found for this booking");
    }

    if (training.calendarEventId) {
      try {
        await this.googleCalendarService.cancelEvent({
          trainingId: training.id,
          eventId: training.calendarEventId,
        });
      } catch (error) {
        const normalizedError = error as Error;
        await this.logCalendarSyncFailure({
          trainingId: training.id,
          operation: SyncOperation.CANCEL,
          externalEventId: training.calendarEventId,
          message: normalizedError.message,
          payload: {
            bookingId: confirmedBooking.id,
            source: "cancelTrainingByClient",
          },
        });
        throw error;
      }
    }

    const result = await this.prismaService.$transaction(async (transaction) => {
      const freshBooking = await this.getConfirmedBookingForClientOrThrow(transaction, bookingId, telegramId);
      const updatedBooking = await transaction.booking.update({
        where: { id: freshBooking.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: now,
          clientComment: this.appendClientActionComment(freshBooking.clientComment, "Клиент отменил тренировку", comment),
        },
        include: {
          client: true,
          slot: true,
        },
      });

      await transaction.training.update({
        where: { bookingId: freshBooking.id },
        data: {
          status: TrainingStatus.CANCELLED,
          cancelledAt: now,
        },
      });

      await transaction.slot.updateMany({
        where: {
          id: freshBooking.slotId,
          status: SlotStatus.BOOKED,
        },
        data: {
          status: SlotStatus.CLOSED,
          heldUntil: null,
          isManuallyClosed: false,
          closureReason: null,
        },
      });

      await transaction.calendarSyncLog.create({
        data: {
          trainingId: training.id,
          operation: SyncOperation.CANCEL,
          status: SyncStatus.SUCCESS,
          externalEventId: training.calendarEventId ?? null,
          message: "Google Calendar event cancelled by client request",
          payload: {
            bookingId: freshBooking.id,
          },
        },
      });

      return {
        status: "cancelled" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyTrainerClientCancellation(result.booking);

    return result;
  }

  async getClientTrainingCalendarFile(telegramId: string, bookingId: string): Promise<ClientTrainingCalendarFileResult> {
    const normalizedTelegramId = telegramId.trim();
    const normalizedBookingId = bookingId.trim();

    if (!normalizedTelegramId) {
      throw new BadRequestException("telegramId is required");
    }
    if (!normalizedBookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const booking = await this.prismaService.booking.findFirst({
      where: {
        id: normalizedBookingId,
        client: {
          telegramId: normalizedTelegramId,
        },
      },
      include: {
        client: true,
        training: true,
      },
    });

    if (!booking || !booking.training) {
      throw new NotFoundException("Training not found");
    }

    const training = booking.training;
    if (training.status === TrainingStatus.CANCELLED || booking.status === BookingStatus.CANCELLED) {
      throw new ConflictException("Cancelled training cannot be exported to calendar");
    }

    const filenameDate = this.formatFileDate(training.startAt);
    const summary = this.escapeIcsText("Твой Бокс — персональная тренировка");
    const descriptionParts = [
      `Клиент: ${booking.client.fullName}`,
      booking.trainerComment ? `Комментарий тренера: ${booking.trainerComment}` : null,
      booking.clientComment ? `Комментарий клиента: ${booking.clientComment}` : null,
    ].filter(Boolean) as string[];

    return {
      filename: `tvoy-box-training-${filenameDate}.ics`,
      content: this.buildCalendarFileContent({
        uid: `${training.id}@tvoy-box`,
        startAt: training.startAt,
        endAt: training.endAt,
        summary,
        description: descriptionParts.join("\n"),
      }),
    };
  }

  async getTrainerBookingCalendarFile(trainerTelegramId: string, bookingId: string): Promise<ClientTrainingCalendarFileResult> {
    this.ensureAdminAccess(trainerTelegramId);

    const normalizedBookingId = bookingId.trim();
    if (!normalizedBookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const booking = await this.prismaService.booking.findUnique({
      where: { id: normalizedBookingId },
      include: {
        client: true,
        slot: true,
        training: true,
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (
      booking.status === BookingStatus.REJECTED
      || booking.status === BookingStatus.CANCELLED
      || booking.status === BookingStatus.EXPIRED
    ) {
      throw new ConflictException("This booking cannot be exported to calendar");
    }

    const filenameDate = this.formatFileDate(booking.slot.startAt);
    const summary = this.escapeIcsText("Твой Бокс — заявка на тренировку");
    const descriptionParts = [
      `Клиент: ${booking.client.fullName}`,
      booking.client.phone ? `Телефон: ${booking.client.phone}` : null,
      booking.client.username ? `Telegram: @${booking.client.username}` : null,
      booking.trainerComment ? `Комментарий тренера: ${booking.trainerComment}` : null,
      booking.clientComment ? `Комментарий клиента: ${booking.clientComment}` : null,
    ].filter(Boolean) as string[];

    return {
      filename: `tvoy-box-booking-${filenameDate}.ics`,
      content: this.buildCalendarFileContent({
        uid: `${booking.training?.id ?? booking.id}@tvoy-box`,
        startAt: booking.slot.startAt,
        endAt: booking.slot.endAt,
        summary,
        description: descriptionParts.join("\n"),
      }),
    };
  }

  async rescheduleTrainingByClient(input: ClientRescheduleTrainingInput): Promise<BookingActionResult> {
    const telegramId = input.telegramId.trim();
    const bookingId = input.bookingId.trim();
    const targetSlotId = input.targetSlotId.trim();
    const comment = input.clientComment?.trim() ?? "";
    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }
    if (!targetSlotId) {
      throw new BadRequestException("targetSlotId is required");
    }

    const now = new Date();
    const result = await this.prismaService.$transaction(async (transaction) => {
      const freshBooking = await this.getConfirmedBookingForClientOrThrow(transaction, bookingId, telegramId);
      const freshTargetSlot = await this.resolveSlotForBooking(transaction, targetSlotId);
      if (freshTargetSlot.id === freshBooking.slotId) {
        throw new ConflictException("Target slot is the same as current slot");
      }
      if (freshTargetSlot.status !== SlotStatus.OPEN) {
        throw new ConflictException("Target slot is not available");
      }

      const settings = await this.ensureTrainerSettings(transaction);
      this.assertSlotWithinBookingRules(
        freshTargetSlot.startAt,
        now,
        settings.bookingHorizonDays,
        settings.sameDayBookingCutoff,
      );

      const expiresAt = this.getEndOfMoscowDay(now);
      const holdTarget = await transaction.slot.updateMany({
        where: {
          id: freshTargetSlot.id,
          status: SlotStatus.OPEN,
        },
        data: {
          status: SlotStatus.HELD,
          heldUntil: expiresAt,
        },
      });

      if (holdTarget.count !== 1) {
        throw new ConflictException("Target slot is no longer available");
      }

      const requestedTimeText = moscowDateTimeFormatter.format(freshTargetSlot.startAt);
      const updatedBooking = await transaction.booking.update({
        where: { id: freshBooking.id },
        data: {
          slotId: freshTargetSlot.id,
          status: BookingStatus.RESCHEDULED,
          expiresAt,
          clientComment: this.appendClientActionComment(
            freshBooking.clientComment,
            `Клиент запросил перенос на ${requestedTimeText}`,
            comment,
          ),
        },
        include: {
          client: true,
          slot: true,
        },
      });

      return {
        status: "rescheduled" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyTrainerClientRescheduleRequest(result.booking);

    return result;
  }

  async confirmBooking(input: ConfirmBookingInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();
    const booking = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);
      return transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          slot: true,
          training: true,
        },
      });
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    const hasTrainerProposal = booking.status === BookingStatus.RESCHEDULED
      && this.extractProposedStartAtFromTrainerComment(booking.trainerComment) !== null;
    const isClientRescheduleRequest = booking.status === BookingStatus.RESCHEDULED
      && Boolean(booking.training)
      && !hasTrainerProposal
      && booking.training!.slotId !== booking.slotId;

    if (booking.status !== BookingStatus.PENDING && !isClientRescheduleRequest) {
      throw new ConflictException("Booking is already processed");
    }

    if (booking.status === BookingStatus.PENDING) {
      this.assertPendingBookingIsActive(booking, now);
      if (booking.slot.status === SlotStatus.BOOKED) {
        throw new ConflictException("Slot is already booked");
      }
      if (booking.slot.status === SlotStatus.CLOSED || booking.slot.status === SlotStatus.CANCELLED) {
        throw new ConflictException("Slot is not available for confirmation");
      }
    } else if (booking.slot.status === SlotStatus.BOOKED || booking.slot.status === SlotStatus.CLOSED || booking.slot.status === SlotStatus.CANCELLED) {
      throw new ConflictException("Slot is not available for confirmation");
    }

    const calendarOperation = booking.training?.calendarEventId ? SyncOperation.UPDATE : SyncOperation.CREATE;
    let calendarSync:
      | Awaited<ReturnType<GoogleCalendarService["createEvent"]>>
      | Awaited<ReturnType<GoogleCalendarService["updateEvent"]>>
      | null = null;
    let calendarSyncErrorMessage: string | null = null;

    try {
      calendarSync = booking.training?.calendarEventId
        ? await this.googleCalendarService.updateEvent(booking.training.calendarEventId, {
            trainingId: booking.training.id,
            clientName: booking.client.fullName,
            clientPhone: booking.client.phone,
            clientUsername: booking.client.username,
            clientTelegramId: booking.client.telegramId,
            startAt: booking.slot.startAt,
            endAt: booking.slot.endAt,
            trainerComment: booking.trainerComment,
          })
        : await this.googleCalendarService.createEvent({
            trainingId: booking.training?.id ?? booking.id,
            clientName: booking.client.fullName,
            clientPhone: booking.client.phone,
            clientUsername: booking.client.username,
            clientTelegramId: booking.client.telegramId,
            startAt: booking.slot.startAt,
            endAt: booking.slot.endAt,
            trainerComment: booking.trainerComment,
          });
    } catch (error) {
      calendarSyncErrorMessage = (error as Error).message;
    }

    const result = await this.prismaService.$transaction(async (transaction) => {
      if (booking.status === BookingStatus.PENDING) {
        const lockedBooking = await this.getPendingBookingOrThrow(transaction, booking.id);
        this.assertPendingBookingIsActive(lockedBooking, now);

        if (lockedBooking.slot.status === SlotStatus.BOOKED) {
          throw new ConflictException("Slot is already booked");
        }

        if (lockedBooking.slot.status === SlotStatus.CLOSED || lockedBooking.slot.status === SlotStatus.CANCELLED) {
          throw new ConflictException("Slot is not available for confirmation");
        }

        const updatedBooking = await transaction.booking.update({
          where: { id: lockedBooking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            confirmedAt: now,
          },
          include: {
            client: true,
            slot: true,
          },
        });

        await transaction.slot.update({
          where: { id: lockedBooking.slotId },
          data: {
            status: SlotStatus.BOOKED,
            heldUntil: null,
            isManuallyClosed: false,
            closureReason: null,
          },
        });

        await transaction.training.upsert({
          where: { bookingId: lockedBooking.id },
          create: {
            bookingId: lockedBooking.id,
            clientId: lockedBooking.clientId,
            slotId: lockedBooking.slotId,
            status: TrainingStatus.SCHEDULED,
            startAt: lockedBooking.slot.startAt,
            endAt: lockedBooking.slot.endAt,
            calendarEventId: calendarSync?.eventId ?? null,
          },
          update: {
            slotId: lockedBooking.slotId,
            status: TrainingStatus.SCHEDULED,
            startAt: lockedBooking.slot.startAt,
            endAt: lockedBooking.slot.endAt,
            calendarEventId: calendarSync?.eventId ?? null,
            cancelledAt: null,
          },
        });

        const training = await transaction.training.findUnique({
          where: { bookingId: lockedBooking.id },
        });

        if (training) {
          await transaction.calendarSyncLog.create({
            data: {
              trainingId: training.id,
              operation: SyncOperation.CREATE,
              status: calendarSync ? SyncStatus.SUCCESS : SyncStatus.FAILED,
              externalEventId: calendarSync?.eventId ?? null,
              message: calendarSync
                ? "Google Calendar event created on booking confirmation"
                : (calendarSyncErrorMessage ?? "Google Calendar sync failed on booking confirmation"),
              payload: {
                mode: calendarSync?.mode ?? this.appConfigService.values.googleCalendarSyncMode,
                bookingId: lockedBooking.id,
                degraded: !calendarSync,
              },
            },
          });
        }

        return {
          status: "confirmed" as const,
          booking: this.toPendingBookingDto(updatedBooking),
        };
      }

      const freshBooking = await transaction.booking.findUnique({
        where: { id: booking.id },
        include: {
          client: true,
          slot: true,
          training: true,
        },
      });

      if (!freshBooking || freshBooking.status !== BookingStatus.RESCHEDULED || !freshBooking.training) {
        throw new ConflictException("Reschedule request is no longer active");
      }

      const updatedBooking = await transaction.booking.update({
        where: { id: freshBooking.id },
        data: {
          status: BookingStatus.CONFIRMED,
          confirmedAt: now,
        },
        include: {
          client: true,
          slot: true,
        },
      });

      await transaction.slot.updateMany({
        where: {
          id: freshBooking.slotId,
          status: SlotStatus.HELD,
        },
        data: {
          status: SlotStatus.BOOKED,
          heldUntil: null,
          isManuallyClosed: false,
          closureReason: null,
        },
      });

      await transaction.training.update({
        where: { bookingId: freshBooking.id },
        data: {
          slotId: freshBooking.slotId,
          startAt: freshBooking.slot.startAt,
          endAt: freshBooking.slot.endAt,
          status: TrainingStatus.RESCHEDULED,
          calendarEventId: calendarSync?.eventId ?? freshBooking.training.calendarEventId ?? null,
          cancelledAt: null,
        },
      });

      await transaction.slot.updateMany({
        where: {
          id: freshBooking.training.slotId,
          status: SlotStatus.BOOKED,
        },
        data: {
          status: SlotStatus.CLOSED,
          heldUntil: null,
          isManuallyClosed: false,
          closureReason: null,
        },
      });

      await transaction.calendarSyncLog.create({
        data: {
          trainingId: freshBooking.training.id,
          operation: calendarOperation,
          status: calendarSync ? SyncStatus.SUCCESS : SyncStatus.FAILED,
          externalEventId: calendarSync?.eventId ?? freshBooking.training.calendarEventId ?? null,
          message: calendarSync
            ? "Google Calendar event synced after trainer confirmed client reschedule"
            : (calendarSyncErrorMessage ?? "Google Calendar sync failed after trainer confirmed client reschedule"),
          payload: {
            mode: calendarSync?.mode ?? this.appConfigService.values.googleCalendarSyncMode,
            bookingId: freshBooking.id,
            degraded: !calendarSync,
          },
        },
      });

      return {
        status: "confirmed" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyClientBookingConfirmed(result.booking);

    return result;
  }

  async rejectBooking(input: RejectBookingInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    const trainerComment = input.trainerComment.trim();

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    if (!trainerComment) {
      throw new BadRequestException("trainerComment is required");
    }

    const now = new Date();

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await this.getPendingBookingOrThrow(transaction, bookingId);
      this.assertPendingBookingIsActive(booking, now);

      const updatedBooking = await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.REJECTED,
          trainerComment,
          rejectedAt: now,
        },
        include: {
          client: true,
          slot: true,
        },
      });

      await this.releaseHeldSlot(transaction, booking.slotId);

      return {
        status: "rejected" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyClientBookingRejected(result.booking);

    return result;
  }

  async proposeBookingTime(input: ProposeBookingTimeInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    const trainerComment = input.trainerComment.trim();
    const proposedStartAt = this.parseIsoDate("proposedStartAt", input.proposedStartAt);

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    if (!trainerComment) {
      throw new BadRequestException("trainerComment is required");
    }

    this.assertFullHourBoundary("proposedStartAt", proposedStartAt);

    const now = new Date();
    if (proposedStartAt.getTime() <= now.getTime()) {
      throw new BadRequestException("proposedStartAt must be in the future");
    }

    const proposedText = [
      `Предложено другое время (МСК): ${moscowDateTimeFormatter.format(proposedStartAt)}`,
      trainerComment,
    ].join("\n");

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await this.getPendingBookingOrThrow(transaction, bookingId);
      this.assertPendingBookingIsActive(booking, now);

      const updatedBooking = await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.RESCHEDULED,
          trainerComment: proposedText,
        },
        include: {
          client: true,
          slot: true,
        },
      });

      await this.releaseHeldSlot(transaction, booking.slotId);

      return {
        status: "proposed" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyClientTrainerProposal(result.booking);

    return result;
  }

  async cancelConfirmedTraining(input: CancelConfirmedTrainingInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    const trainerComment = input.trainerComment.trim();
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }
    if (!trainerComment) {
      throw new BadRequestException("trainerComment is required");
    }

    const now = new Date();
    const booking = await this.prismaService.$transaction(async (transaction) => {
      return this.getConfirmedBookingOrThrow(transaction, bookingId);
    });
    const training = booking.training;
    if (!training) {
      throw new ConflictException("Training record not found for this booking");
    }

    if (training.calendarEventId) {
      try {
        await this.googleCalendarService.cancelEvent({
          trainingId: training.id,
          eventId: training.calendarEventId,
        });
      } catch (error) {
        const normalizedError = error as Error;
        await this.logCalendarSyncFailure({
          trainingId: training.id,
          operation: SyncOperation.CANCEL,
          externalEventId: training.calendarEventId,
          message: normalizedError.message,
          payload: {
            bookingId: booking.id,
          },
        });
        throw error;
      }
    }

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CANCELLED,
          trainerComment,
          cancelledAt: now,
        },
      });

      await transaction.training.update({
        where: { bookingId: booking.id },
        data: {
          status: TrainingStatus.CANCELLED,
          cancelledAt: now,
        },
      });

      await transaction.slot.updateMany({
        where: {
          id: booking.slotId,
          status: SlotStatus.BOOKED,
        },
        data: {
          status: SlotStatus.CLOSED,
          heldUntil: null,
          isManuallyClosed: false,
          closureReason: null,
        },
      });

      await transaction.calendarSyncLog.create({
        data: {
          trainingId: training.id,
          operation: SyncOperation.CANCEL,
          status: SyncStatus.SUCCESS,
          externalEventId: training.calendarEventId ?? null,
          message: "Google Calendar event cancelled on training cancellation",
          payload: {
            bookingId: booking.id,
            trainerComment,
          },
        },
      });

      const updatedBooking = await transaction.booking.findUnique({
        where: { id: booking.id },
        include: {
          client: true,
          slot: true,
        },
      });

      if (!updatedBooking) {
        throw new NotFoundException("Booking not found");
      }

      return {
        status: "cancelled" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyClientTrainerCancellation(result.booking);

    return result;
  }

  async rescheduleConfirmedTraining(input: RescheduleConfirmedTrainingInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    const trainerComment = input.trainerComment.trim();
    const newStartAt = this.parseIsoDate("newStartAt", input.newStartAt);
    const newEndAt = new Date(newStartAt.getTime() + HOUR_MS);

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }
    if (!trainerComment) {
      throw new BadRequestException("trainerComment is required");
    }
    this.assertFullHourBoundary("newStartAt", newStartAt);

    const now = new Date();
    if (newStartAt.getTime() <= now.getTime()) {
      throw new BadRequestException("newStartAt must be in the future");
    }

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      const booking = await this.getConfirmedBookingOrThrow(transaction, bookingId);

      let targetSlot = await transaction.slot.findUnique({
        where: {
          startAt_endAt: {
            startAt: newStartAt,
            endAt: newEndAt,
          },
        },
      });

      if (!targetSlot) {
        targetSlot = await transaction.slot.create({
          data: {
            startAt: newStartAt,
            endAt: newEndAt,
            status: SlotStatus.OPEN,
          },
        });
      }

      if (targetSlot.id !== booking.slotId && targetSlot.status !== SlotStatus.OPEN) {
        throw new ConflictException("Target slot is not available");
      }

      const rescheduleComment = [
        `Предложено другое время (МСК): ${moscowDateTimeFormatter.format(newStartAt)}`,
        trainerComment,
      ].join("\n");

      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          trainerComment: rescheduleComment,
          status: BookingStatus.RESCHEDULED,
        },
      });

      const updatedBooking = await transaction.booking.findUnique({
        where: { id: booking.id },
        include: {
          client: true,
          slot: true,
        },
      });

      if (!updatedBooking) {
        throw new NotFoundException("Booking not found");
      }

      return {
        status: "rescheduled" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyClientTrainerProposal(result.booking);

    return result;
  }

  async acceptProposedBookingTime(input: ClientProposalDecisionInput): Promise<BookingActionResult> {
    const telegramId = input.telegramId.trim();
    const bookingId = input.bookingId.trim();

    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();
    const booking = await this.prismaService.$transaction(async (transaction) => {
      return this.getRescheduledBookingForClientOrThrow(transaction, bookingId, telegramId);
    });
    const proposedStartAt = this.extractProposedStartAtFromTrainerComment(booking.trainerComment);
    if (!proposedStartAt) {
      throw new ConflictException("No proposed time found for this booking");
    }

    if (proposedStartAt.getTime() <= now.getTime()) {
      throw new ConflictException("Proposed time is already in the past");
    }

    const proposedEndAt = new Date(proposedStartAt.getTime() + HOUR_MS);
    const calendarOperation = booking.training?.calendarEventId ? SyncOperation.UPDATE : SyncOperation.CREATE;
    let calendarSync:
      | Awaited<ReturnType<GoogleCalendarService["createEvent"]>>
      | Awaited<ReturnType<GoogleCalendarService["updateEvent"]>>
      | null = null;
    let calendarSyncErrorMessage: string | null = null;
    try {
      calendarSync = booking.training?.calendarEventId
        ? await this.googleCalendarService.updateEvent(booking.training.calendarEventId, {
            trainingId: booking.training.id,
            clientName: booking.client.fullName,
            clientPhone: booking.client.phone,
            clientUsername: booking.client.username,
            clientTelegramId: booking.client.telegramId,
            startAt: proposedStartAt,
            endAt: proposedEndAt,
            trainerComment: booking.trainerComment,
          })
        : await this.googleCalendarService.createEvent({
            trainingId: booking.training?.id ?? booking.id,
            clientName: booking.client.fullName,
            clientPhone: booking.client.phone,
            clientUsername: booking.client.username,
            clientTelegramId: booking.client.telegramId,
            startAt: proposedStartAt,
            endAt: proposedEndAt,
            trainerComment: booking.trainerComment,
          });
    } catch (error) {
      calendarSync = null;
      calendarSyncErrorMessage = (error as Error).message;
    }

    const result = await this.prismaService.$transaction(async (transaction) => {
      const freshBooking = await this.getRescheduledBookingForClientOrThrow(transaction, bookingId, telegramId);

      let targetSlot = await transaction.slot.findUnique({
        where: {
          startAt_endAt: {
            startAt: proposedStartAt,
            endAt: proposedEndAt,
          },
        },
      });

      if (!targetSlot) {
        targetSlot = await transaction.slot.create({
          data: {
            startAt: proposedStartAt,
            endAt: proposedEndAt,
            status: SlotStatus.OPEN,
          },
        });
      }

      if (targetSlot.id !== freshBooking.slotId && targetSlot.status !== SlotStatus.OPEN) {
        throw new ConflictException("Proposed slot is not available");
      }

      const settings = await this.ensureTrainerSettings(transaction);
      this.assertSlotWithinBookingRules(
        proposedStartAt,
        now,
        settings.bookingHorizonDays,
        settings.sameDayBookingCutoff,
      );
      if (targetSlot.id !== freshBooking.slotId) {
        const lockTarget = await transaction.slot.updateMany({
          where: {
            id: targetSlot.id,
            status: SlotStatus.OPEN,
          },
          data: {
            status: SlotStatus.BOOKED,
            heldUntil: null,
            isManuallyClosed: false,
            closureReason: null,
          },
        });

        if (lockTarget.count !== 1) {
          throw new ConflictException("Proposed slot is no longer available");
        }
      }

      await transaction.booking.update({
        where: { id: freshBooking.id },
        data: {
          slotId: targetSlot.id,
          status: BookingStatus.CONFIRMED,
          confirmedAt: now,
        },
      });

      await transaction.training.upsert({
        where: { bookingId: freshBooking.id },
        create: {
          bookingId: freshBooking.id,
          clientId: freshBooking.clientId,
          slotId: targetSlot.id,
          status: TrainingStatus.RESCHEDULED,
          startAt: proposedStartAt,
          endAt: proposedEndAt,
          calendarEventId: calendarSync?.eventId ?? freshBooking.training?.calendarEventId ?? null,
        },
        update: {
          slotId: targetSlot.id,
          startAt: proposedStartAt,
          endAt: proposedEndAt,
          status: TrainingStatus.RESCHEDULED,
          cancelledAt: null,
          calendarEventId: calendarSync?.eventId ?? freshBooking.training?.calendarEventId ?? null,
        },
      });

      if (targetSlot.id !== freshBooking.slotId) {
        await transaction.slot.updateMany({
          where: {
            id: freshBooking.slotId,
            status: SlotStatus.BOOKED,
          },
          data: {
            status: SlotStatus.CLOSED,
            heldUntil: null,
            isManuallyClosed: false,
            closureReason: null,
          },
        });
      }

      const persistedTraining = await transaction.training.findUnique({
        where: { bookingId: freshBooking.id },
      });
      if (persistedTraining) {
        await transaction.calendarSyncLog.create({
          data: {
            trainingId: persistedTraining.id,
            operation: calendarOperation,
            status: calendarSync ? SyncStatus.SUCCESS : SyncStatus.FAILED,
            externalEventId: calendarSync?.eventId ?? freshBooking.training?.calendarEventId ?? null,
            message: calendarSync
              ? "Google Calendar event synced after client accepted proposal"
              : (calendarSyncErrorMessage ?? "Google Calendar sync failed after client accepted proposal"),
            payload: {
              mode: calendarSync?.mode ?? this.appConfigService.values.googleCalendarSyncMode,
              bookingId: freshBooking.id,
              degraded: !calendarSync,
            },
          },
        });
      }

      const updatedBooking = await transaction.booking.findUnique({
        where: { id: freshBooking.id },
        include: {
          client: true,
          slot: true,
        },
      });

      if (!updatedBooking) {
        throw new NotFoundException("Booking not found");
      }

      return {
        status: "confirmed" as const,
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyTrainerClientProposalDecision(result.booking, true);

    return result;
  }

  async declineProposedBookingTime(input: ClientProposalDecisionInput): Promise<BookingActionResult> {
    const telegramId = input.telegramId.trim();
    const bookingId = input.bookingId.trim();
    const decisionNote = input.decisionNote?.trim();

    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();

    const result: BookingActionResult = await this.prismaService.$transaction(async (transaction) => {
      const booking = await this.getRescheduledBookingForClientOrThrow(transaction, bookingId, telegramId);

      const trainerComment = decisionNote
        ? `${booking.trainerComment ?? ""}\nКлиент отклонил предложенное время: ${decisionNote}`.trim()
        : `${booking.trainerComment ?? ""}\nКлиент отклонил предложенное время.`.trim();

      const updatedBooking = await transaction.booking.update({
        where: { id: booking.id },
        data: booking.training
          ? {
              status: BookingStatus.CONFIRMED,
              trainerComment,
            }
          : {
              status: BookingStatus.REJECTED,
              trainerComment,
              rejectedAt: now,
            },
        include: {
          client: true,
          slot: true,
        },
      });

      return {
        status: (booking.training ? "confirmed" : "rejected") as "confirmed" | "rejected",
        booking: this.toPendingBookingDto(updatedBooking),
      };
    });

    await this.notifyTrainerClientProposalDecision(result.booking, false, decisionNote);

    return result;
  }

  async forceCloseBooking(input: ForceCloseBookingInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    const trainerComment = input.trainerComment?.trim() ?? "Заявка закрыта тренером.";

    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const now = new Date();

    return this.prismaService.$transaction(async (transaction) => {
      await this.releaseExpiredPendingBookings(transaction, now);

      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          client: true,
          slot: true,
          training: true,
        },
      });

      if (!booking) {
        throw new NotFoundException("Booking not found");
      }

      if (booking.status === BookingStatus.PENDING) {
        const updatedBooking = await transaction.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            trainerComment,
            cancelledAt: now,
          },
          include: {
            client: true,
            slot: true,
          },
        });

        await this.releaseHeldSlot(transaction, booking.slotId);

        return {
          status: "cancelled",
          booking: this.toPendingBookingDto(updatedBooking),
        };
      }

      if (booking.status === BookingStatus.RESCHEDULED) {
        if (booking.training && booking.training.status !== TrainingStatus.CANCELLED) {
          const revertToTrainingSlot = booking.training.slotId !== booking.slotId;
          const updatedBooking = await transaction.booking.update({
            where: { id: booking.id },
            data: {
              status: BookingStatus.CONFIRMED,
              slotId: revertToTrainingSlot ? booking.training.slotId : booking.slotId,
              trainerComment: `${booking.trainerComment ?? ""}\nПредложение закрыто тренером. ${trainerComment}`.trim(),
            },
            include: {
              client: true,
              slot: true,
            },
          });

          if (revertToTrainingSlot) {
            await this.releaseHeldSlot(transaction, booking.slotId);
          }

          return {
            status: "confirmed",
            booking: this.toPendingBookingDto(updatedBooking),
          };
        }

        const updatedBooking = await transaction.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CANCELLED,
            trainerComment: `${booking.trainerComment ?? ""}\n${trainerComment}`.trim(),
            cancelledAt: now,
          },
          include: {
            client: true,
            slot: true,
          },
        });

        return {
          status: "cancelled",
          booking: this.toPendingBookingDto(updatedBooking),
        };
      }

      throw new ConflictException("Booking cannot be force-closed in current status");
    });
  }

  async resyncBookingCalendar(input: ResyncBookingCalendarInput): Promise<BookingActionResult> {
    this.ensureAdminAccess(input.trainerTelegramId);

    const bookingId = input.bookingId.trim();
    if (!bookingId) {
      throw new BadRequestException("bookingId is required");
    }

    const booking = await this.prismaService.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
        training: true,
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (!booking.training) {
      throw new ConflictException("Training record not found for this booking");
    }
    const training = booking.training;

    let action: "create" | "recreate" | "cancel" | "noop" = "noop";
    let externalEventId = training.calendarEventId ?? null;
    try {
      if (training.status === TrainingStatus.CANCELLED || booking.status === BookingStatus.CANCELLED) {
        if (training.calendarEventId) {
          await this.googleCalendarService.cancelEvent({
            trainingId: training.id,
            eventId: training.calendarEventId,
          });
          action = "cancel";
        }
      } else if (training.calendarEventId) {
        try {
          await this.googleCalendarService.cancelEvent({
            trainingId: training.id,
            eventId: training.calendarEventId,
          });
        } catch (error) {
          if (!this.googleCalendarService.isGoogleNotFoundError(error)) {
            throw error;
          }
        }

        const syncResult = await this.googleCalendarService.createEvent({
          trainingId: training.id,
          clientName: booking.client.fullName,
          clientPhone: booking.client.phone,
          clientUsername: booking.client.username,
          clientTelegramId: booking.client.telegramId,
          startAt: training.startAt,
          endAt: training.endAt,
          trainerComment: booking.trainerComment,
        });
        externalEventId = syncResult.eventId;
        action = "recreate";
      } else {
        const syncResult = await this.googleCalendarService.createEvent({
          trainingId: training.id,
          clientName: booking.client.fullName,
          clientPhone: booking.client.phone,
          clientUsername: booking.client.username,
          clientTelegramId: booking.client.telegramId,
          startAt: training.startAt,
          endAt: training.endAt,
          trainerComment: booking.trainerComment,
        });
        externalEventId = syncResult.eventId;
        action = "create";
      }
    } catch (error) {
      const normalizedError = error as Error;
      await this.logCalendarSyncFailure({
        trainingId: training.id,
        operation: SyncOperation.RESYNC,
        externalEventId: training.calendarEventId,
        message: normalizedError.message,
        payload: {
          bookingId: booking.id,
        },
      });
      throw error;
    }

    return this.prismaService.$transaction(async (transaction) => {
      if (externalEventId && externalEventId !== training.calendarEventId) {
        await transaction.training.update({
          where: { id: training.id },
          data: {
            calendarEventId: externalEventId,
          },
        });
      }

      await transaction.calendarSyncLog.create({
        data: {
          trainingId: training.id,
          operation: SyncOperation.RESYNC,
          status: SyncStatus.SUCCESS,
          externalEventId,
          message: "Manual booking calendar re-sync completed",
          payload: {
            bookingId: booking.id,
            action,
          },
        },
      });

      const refreshed = await transaction.booking.findUnique({
        where: { id: booking.id },
        include: {
          client: true,
          slot: true,
        },
      });
      if (!refreshed) {
        throw new NotFoundException("Booking not found");
      }

      return {
        status: "resynced" as const,
        booking: this.toPendingBookingDto(refreshed),
      };
    });
  }

  private async logCalendarSyncFailure(input: {
    trainingId: string;
    operation: SyncOperation;
    externalEventId?: string | null;
    message: string;
    payload?: Prisma.InputJsonObject;
  }): Promise<void> {
    await this.prismaService.calendarSyncLog.create({
      data: {
        trainingId: input.trainingId,
        operation: input.operation,
        status: SyncStatus.FAILED,
        externalEventId: input.externalEventId ?? null,
        message: input.message,
        payload: input.payload,
      },
    });
  }

  private toIcsUtc(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    const hours = String(value.getUTCHours()).padStart(2, "0");
    const minutes = String(value.getUTCMinutes()).padStart(2, "0");
    const seconds = String(value.getUTCSeconds()).padStart(2, "0");

    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  }

  private buildCalendarFileContent(input: {
    uid: string;
    startAt: Date;
    endAt: Date;
    summary: string;
    description: string;
  }): string {
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Tvoy Box//Mini App//RU",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${input.uid}`,
      `DTSTAMP:${this.toIcsUtc(new Date())}`,
      `DTSTART:${this.toIcsUtc(input.startAt)}`,
      `DTEND:${this.toIcsUtc(input.endAt)}`,
      `SUMMARY:${input.summary}`,
      `DESCRIPTION:${this.escapeIcsText(input.description)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Напоминание о тренировке завтра",
      "TRIGGER:-P1D",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Напоминание о тренировке через 1 час",
      "TRIGGER:-PT1H",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  private formatFileDate(value: Date): string {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    const hours = String(value.getUTCHours()).padStart(2, "0");
    const minutes = String(value.getUTCMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}-${hours}-${minutes}`;
  }

  private escapeIcsText(value: string): string {
    return value
      .replaceAll("\\", "\\\\")
      .replaceAll(";", "\\;")
      .replaceAll(",", "\\,")
      .replaceAll("\r\n", "\\n")
      .replaceAll("\n", "\\n");
  }

  private async releaseExpiredHoldForSlot(
    transaction: PrismaTransactionClient,
    slot: { id: string; status: SlotStatus; heldUntil: Date | null },
    now: Date,
  ): Promise<void> {
    if (slot.status !== SlotStatus.HELD) {
      return;
    }

    if (!slot.heldUntil || slot.heldUntil.getTime() > now.getTime()) {
      return;
    }

    await transaction.booking.updateMany({
      where: {
        slotId: slot.id,
        status: BookingStatus.PENDING,
        expiresAt: {
          lte: now,
        },
      },
      data: {
        status: BookingStatus.EXPIRED,
      },
    });

    await transaction.slot.update({
      where: { id: slot.id },
      data: {
        status: SlotStatus.OPEN,
        heldUntil: null,
      },
    });
  }

  private async releaseExpiredPendingBookings(transaction: PrismaTransactionClient, now: Date): Promise<void> {
    const expiredBookings = await transaction.booking.findMany({
      where: {
        status: BookingStatus.PENDING,
        expiresAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        slotId: true,
      },
      take: 200,
    });

    if (expiredBookings.length === 0) {
      return;
    }

    await transaction.booking.updateMany({
      where: {
        id: {
          in: expiredBookings.map((booking) => booking.id),
        },
      },
      data: {
        status: BookingStatus.EXPIRED,
      },
    });

    await transaction.slot.updateMany({
      where: {
        id: {
          in: expiredBookings.map((booking) => booking.slotId),
        },
        status: SlotStatus.HELD,
      },
      data: {
        status: SlotStatus.OPEN,
        heldUntil: null,
      },
    });
  }

  private async getPendingBookingOrThrow(transaction: PrismaTransactionClient, bookingId: string) {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException("Booking is already processed");
    }

    return booking;
  }

  private async getConfirmedBookingOrThrow(transaction: PrismaTransactionClient, bookingId: string) {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
        training: true,
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException("Only confirmed booking can be changed");
    }

    if (!booking.training) {
      throw new ConflictException("Training record not found for this booking");
    }

    if (booking.training.status === TrainingStatus.CANCELLED) {
      throw new ConflictException("Training is already cancelled");
    }

    return booking;
  }

  private async getConfirmedBookingForClientOrThrow(
    transaction: PrismaTransactionClient,
    bookingId: string,
    clientTelegramId: string,
  ): Promise<ConfirmedClientBookingWithRelations> {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
        training: {
          select: {
            id: true,
            status: true,
            slotId: true,
            calendarEventId: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.client.telegramId !== clientTelegramId) {
      throw new ForbiddenException("Booking does not belong to this client");
    }

    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException("Only confirmed booking can be changed");
    }

    if (booking.slot.startAt.getTime() <= Date.now()) {
      throw new ConflictException("Cannot change past training");
    }

    if (!booking.training) {
      throw new ConflictException("Training record not found for this booking");
    }

    if (booking.training.status === TrainingStatus.CANCELLED) {
      throw new ConflictException("Training is already cancelled");
    }

    return booking;
  }

  private async getRescheduledBookingForClientOrThrow(
    transaction: PrismaTransactionClient,
    bookingId: string,
    clientTelegramId: string,
  ): Promise<RescheduledBookingWithRelations> {
    const booking = await transaction.booking.findUnique({
      where: { id: bookingId },
      include: {
        client: true,
        slot: true,
        training: {
          select: {
            id: true,
            status: true,
            slotId: true,
            calendarEventId: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException("Booking not found");
    }

    if (booking.client.telegramId !== clientTelegramId) {
      throw new ForbiddenException("Booking does not belong to this client");
    }

    if (booking.status !== BookingStatus.RESCHEDULED) {
      throw new ConflictException("Booking has no active proposal");
    }

    return booking;
  }

  private extractProposedStartAtFromTrainerComment(comment: string | null): Date | null {
    if (!comment) {
      return null;
    }

    const match = comment.match(
      /Предложено другое время \(МСК\):\s*(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})/u,
    );

    if (!match) {
      return null;
    }

    const [, dayRaw, monthRaw, yearRaw, hoursRaw, minutesRaw] = match;
    const day = Number(dayRaw);
    const month = Number(monthRaw);
    const year = Number(yearRaw);
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if ([day, month, year, hours, minutes].some((value) => Number.isNaN(value))) {
      return null;
    }

    // Moscow time is UTC+3 for this project.
    return new Date(Date.UTC(year, month - 1, day, hours - 3, minutes, 0, 0));
  }

  private assertPendingBookingIsActive(
    booking: {
      expiresAt: Date;
    },
    now: Date,
  ): void {
    if (booking.expiresAt.getTime() < now.getTime()) {
      throw new ConflictException("Booking request expired");
    }
  }

  private async releaseHeldSlot(transaction: PrismaTransactionClient, slotId: string): Promise<void> {
    await transaction.slot.updateMany({
      where: {
        id: slotId,
        status: SlotStatus.HELD,
      },
      data: {
        status: SlotStatus.OPEN,
        heldUntil: null,
      },
    });
  }

  private ensureAdminAccess(actorTelegramId: string): void {
    const actorId = actorTelegramId.trim();
    if (!actorId) {
      throw new ForbiddenException("trainerTelegramId is required");
    }

    const allowed = new Set([
      this.appConfigService.values.trainerTelegramId,
      this.appConfigService.values.adminTelegramId,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException("Only trainer/admin can manage booking requests");
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

  private toPendingBookingDto(booking: {
    id: string;
    status: BookingStatus;
    createdAt: Date;
    expiresAt: Date;
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
      startAt: Date;
      endAt: Date;
      status: SlotStatus;
    };
  }): PendingBookingDto {
    return {
      id: booking.id,
      status: booking.status,
      createdAt: booking.createdAt.toISOString(),
      expiresAt: booking.expiresAt.toISOString(),
      clientComment: booking.clientComment,
      trainerComment: booking.trainerComment,
      client: {
        id: booking.client.id,
        telegramId: booking.client.telegramId,
        fullName: booking.client.fullName,
        username: booking.client.username,
        phone: booking.client.phone,
      },
      slot: {
        id: booking.slot.id,
        startAt: booking.slot.startAt.toISOString(),
        endAt: booking.slot.endAt.toISOString(),
        status: booking.slot.status,
      },
    };
  }

  private async notifyClientBookingConfirmed(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyClientAboutBookingConfirmed({
      bookingId: booking.id,
      clientTelegramId: booking.client.telegramId,
      startAt: booking.slot.startAt,
    });
  }

  private async notifyClientBookingRejected(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyClientAboutBookingRejected({
      bookingId: booking.id,
      clientTelegramId: booking.client.telegramId,
      startAt: booking.slot.startAt,
      trainerComment: booking.trainerComment,
    });
  }

  private async notifyClientTrainerProposal(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyClientAboutTrainerProposal({
      bookingId: booking.id,
      clientTelegramId: booking.client.telegramId,
      trainerComment: booking.trainerComment,
    });
  }

  private async notifyClientTrainerCancellation(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyClientAboutTrainerCancellation({
      bookingId: booking.id,
      clientTelegramId: booking.client.telegramId,
      startAt: booking.slot.startAt,
      trainerComment: booking.trainerComment,
    });
  }

  private async notifyTrainerClientCancellation(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyTrainerAboutClientCancellation({
      bookingId: booking.id,
      client: {
        fullName: booking.client.fullName,
        telegramId: booking.client.telegramId,
        username: booking.client.username,
        phone: booking.client.phone,
      },
      startAt: booking.slot.startAt,
      clientComment: booking.clientComment,
    });
  }

  private async notifyTrainerClientRescheduleRequest(booking: PendingBookingDto) {
    await this.telegramNotificationsService.notifyTrainerAboutClientRescheduleRequest({
      bookingId: booking.id,
      client: {
        fullName: booking.client.fullName,
        telegramId: booking.client.telegramId,
        username: booking.client.username,
        phone: booking.client.phone,
      },
      startAt: booking.slot.startAt,
      clientComment: booking.clientComment,
    });
  }

  private async notifyTrainerClientProposalDecision(
    booking: PendingBookingDto,
    accepted: boolean,
    decisionNote?: string,
  ) {
    await this.telegramNotificationsService.notifyTrainerAboutClientProposalDecision({
      bookingId: booking.id,
      client: {
        fullName: booking.client.fullName,
        telegramId: booking.client.telegramId,
        username: booking.client.username,
        phone: booking.client.phone,
      },
      startAt: booking.slot.startAt,
      accepted,
      decisionNote,
    });
  }

  private getBookingStatusPriority(status: BookingStatus): number {
    switch (status) {
      case BookingStatus.PENDING:
        return 0;
      case BookingStatus.CONFIRMED:
        return 1;
      case BookingStatus.RESCHEDULED:
        return 2;
      case BookingStatus.REJECTED:
        return 3;
      case BookingStatus.CANCELLED:
        return 4;
      case BookingStatus.EXPIRED:
        return 5;
      default:
        return 10;
    }
  }

  private async resolveSlotForBooking(
    transaction: PrismaTransactionClient,
    slotId: string,
  ) {
    const virtualSlot = this.parseVirtualSlotId(slotId);
    if (virtualSlot) {
      this.assertFullHourBoundary("slotStartAt", virtualSlot.startAt);
      this.assertFullHourBoundary("slotEndAt", virtualSlot.endAt);

      if (virtualSlot.endAt.getTime() - virtualSlot.startAt.getTime() !== HOUR_MS) {
        throw new BadRequestException("Virtual slot must be exactly 60 minutes");
      }

      return transaction.slot.upsert({
        where: {
          startAt_endAt: {
            startAt: virtualSlot.startAt,
            endAt: virtualSlot.endAt,
          },
        },
        create: {
          startAt: virtualSlot.startAt,
          endAt: virtualSlot.endAt,
          status: SlotStatus.OPEN,
        },
        update: {},
      });
    }

    const slot = await transaction.slot.findUnique({
      where: { id: slotId },
    });

    if (!slot) {
      throw new BadRequestException("Slot not found");
    }

    return slot;
  }

  private assertSlotWithinBookingRules(
    slotStartAt: Date,
    now: Date,
    bookingHorizonDays: number,
    sameDayBookingCutoffHours: number,
  ): void {
    if (slotStartAt.getTime() <= now.getTime()) {
      throw new ConflictException("Cannot book past slot");
    }

    const horizonEnd = this.getBookingHorizonExclusiveEnd(now, bookingHorizonDays);
    if (slotStartAt.getTime() >= horizonEnd.getTime()) {
      throw new ForbiddenException("Slot is outside booking horizon");
    }

    if (sameDayBookingCutoffHours > 0 && this.getMoscowDateKey(slotStartAt) === this.getMoscowDateKey(now)) {
      const cutoffMoment = new Date(now.getTime() + sameDayBookingCutoffHours * HOUR_MS);
      if (slotStartAt.getTime() < cutoffMoment.getTime()) {
        throw new ForbiddenException("Slot is outside same-day booking cutoff");
      }
    }
  }

  private async ensureTrainerSettings(
    transaction: PrismaTransactionClient,
  ) {
    const existing = await transaction.trainerSettings.findFirst();
    if (existing) {
      return existing;
    }

    return transaction.trainerSettings.create({
      data: {
        bookingHorizonDays: 14,
        sameDayBookingCutoff: 0,
      },
    });
  }

  private getMoscowDateKey(date: Date): string {
    const shifted = new Date(date.getTime() + MOSCOW_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private getMoscowDayRange(date: Date): { from: Date; to: Date } {
    const shifted = new Date(date.getTime() + MOSCOW_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();

    const startShiftedUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
    const from = new Date(startShiftedUtc - MOSCOW_OFFSET_MS);
    const to = new Date(from.getTime() + DAY_MS);

    return { from, to };
  }

  private getEndOfMoscowDay(date: Date): Date {
    const { to } = this.getMoscowDayRange(date);
    return new Date(to.getTime() - 1);
  }

  private getBookingHorizonExclusiveEnd(now: Date, bookingHorizonDays: number): Date {
    const safeDays = Number.isFinite(bookingHorizonDays) && bookingHorizonDays > 0
      ? Math.trunc(bookingHorizonDays)
      : 14;
    const { from } = this.getMoscowDayRange(now);
    return new Date(from.getTime() + (safeDays + 1) * DAY_MS);
  }

  private parseVirtualSlotId(slotId: string): { startAt: Date; endAt: Date } | null {
    const parts = slotId.split("|");
    const [prefix, startRaw, endRaw, extra] = parts;
    if (prefix !== VIRTUAL_SLOT_PREFIX || !startRaw) {
      return null;
    }

    // New compact format: virtual|<startAtEpochMs>
    if (parts.length === 2) {
      const startMs = Number(startRaw);
      if (!Number.isFinite(startMs)) {
        throw new BadRequestException("Virtual slot id contains invalid timestamp");
      }

      const startAt = new Date(startMs);
      const endAt = new Date(startMs + HOUR_MS);

      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new BadRequestException("Virtual slot id contains invalid date");
      }

      return { startAt, endAt };
    }

    // Backward compatibility: virtual|<startIso>|<endIso>
    if (!endRaw || extra) {
      throw new BadRequestException("Virtual slot id has invalid format");
    }

    const startAt = new Date(startRaw);
    const endAt = new Date(endRaw);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException("Virtual slot id contains invalid date");
    }

    if (endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException("Virtual slot has invalid range");
    }

    return { startAt, endAt };
  }

  private appendClientActionComment(previous: string | null, actionLabel: string, userComment: string): string {
    const actionLine = userComment
      ? `${actionLabel}: ${userComment}`
      : actionLabel;
    return previous
      ? `${previous}\n${actionLine}`
      : actionLine;
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
}


