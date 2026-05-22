import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NoSlotRequestStatus } from "@prisma/client";

import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../prisma/prisma.service";

export interface CreateNoSlotRequestInput {
  telegramId: string;
  preferredDays: string[];
  preferredTime?: string | null;
  clientComment?: string | null;
}

export interface NoSlotRequestDto {
  id: string;
  status: NoSlotRequestStatus;
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
    note: string | null;
    isBlacklisted: boolean;
  };
}

export interface CreateNoSlotRequestResult {
  status: "created";
  request: NoSlotRequestDto;
}

export interface ListNoSlotRequestsInput {
  trainerTelegramId: string;
  status?: NoSlotRequestStatus;
}

export interface ListNoSlotRequestsResult {
  status: "ok";
  items: NoSlotRequestDto[];
}

export interface UpdateNoSlotRequestInput {
  trainerTelegramId: string;
  requestId: string;
  status: NoSlotRequestStatus;
  trainerComment?: string | null;
}

export interface UpdateNoSlotRequestResult {
  status: "updated";
  request: NoSlotRequestDto;
}

@Injectable()
export class NoSlotRequestsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly appConfigService: AppConfigService,
  ) {}

  async createRequest(input: CreateNoSlotRequestInput): Promise<CreateNoSlotRequestResult> {
    const telegramId = input.telegramId.trim();
    const preferredDays = input.preferredDays.map((day) => day.trim()).filter(Boolean);
    const preferredTime = input.preferredTime?.trim() || null;
    const clientComment = input.clientComment?.trim() || null;

    if (!telegramId) {
      throw new BadRequestException("telegramId is required");
    }

    if (preferredDays.length === 0) {
      throw new BadRequestException("preferredDays is required");
    }

    if (preferredDays.length > 10) {
      throw new BadRequestException("preferredDays is too long");
    }

    const client = await this.prismaService.client.findUnique({
      where: { telegramId },
    });

    if (!client) {
      throw new BadRequestException("Client is not registered");
    }

    if (client.isBlacklisted) {
      throw new ForbiddenException("Client is blacklisted");
    }

    const created = await this.prismaService.noSlotRequest.create({
      data: {
        clientId: client.id,
        preferredDays,
        preferredTime,
        clientComment,
      },
      include: {
        client: true,
      },
    });

    return {
      status: "created",
      request: {
        id: created.id,
        status: created.status,
        preferredDays: created.preferredDays,
        preferredTime: created.preferredTime,
        clientComment: created.clientComment,
        trainerComment: created.trainerComment,
        createdAt: created.createdAt.toISOString(),
        client: {
          id: created.client.id,
          telegramId: created.client.telegramId,
          fullName: created.client.fullName,
          username: created.client.username,
          phone: created.client.phone,
          note: created.client.note ?? null,
          isBlacklisted: created.client.isBlacklisted,
        },
      },
    };
  }

  async listForTrainer(input: ListNoSlotRequestsInput): Promise<ListNoSlotRequestsResult> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const items = await this.prismaService.noSlotRequest.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
      },
      include: {
        client: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });

    const sorted = items.sort((left, right) => {
      const leftPriority = this.getStatusPriority(left.status);
      const rightPriority = this.getStatusPriority(right.status);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return right.createdAt.getTime() - left.createdAt.getTime();
    });

    return {
      status: "ok",
      items: sorted.map((item) => this.toDto(item)),
    };
  }

  async updateByTrainer(input: UpdateNoSlotRequestInput): Promise<UpdateNoSlotRequestResult> {
    this.ensureTrainerAccess(input.trainerTelegramId);

    const requestId = input.requestId.trim();
    const trainerComment = input.trainerComment?.trim() || null;
    if (!requestId) {
      throw new BadRequestException("requestId is required");
    }

    if (![NoSlotRequestStatus.NEW, NoSlotRequestStatus.REVIEWED, NoSlotRequestStatus.ARCHIVED].includes(input.status)) {
      throw new BadRequestException("Unsupported no-slot request status");
    }

    const existing = await this.prismaService.noSlotRequest.findUnique({
      where: { id: requestId },
      include: { client: true },
    });

    if (!existing) {
      throw new NotFoundException("No-slot request not found");
    }

    const updated = await this.prismaService.noSlotRequest.update({
      where: { id: requestId },
      data: {
        status: input.status,
        trainerComment,
        reviewedAt:
          input.status === NoSlotRequestStatus.NEW
            ? null
            : existing.reviewedAt ?? new Date(),
      },
      include: {
        client: true,
      },
    });

    return {
      status: "updated",
      request: this.toDto(updated),
    };
  }

  private ensureTrainerAccess(trainerTelegramId: string): void {
    const actorId = trainerTelegramId.trim();
    const allowed = new Set([
      this.appConfigService.values.trainerTelegramId,
      this.appConfigService.values.adminTelegramId,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException("Only trainer/admin can manage no-slot requests");
    }
  }

  private getStatusPriority(status: NoSlotRequestStatus): number {
    switch (status) {
      case NoSlotRequestStatus.NEW:
        return 0;
      case NoSlotRequestStatus.REVIEWED:
        return 1;
      case NoSlotRequestStatus.ARCHIVED:
        return 2;
      default:
        return 10;
    }
  }

  private toDto(item: {
    id: string;
    status: NoSlotRequestStatus;
    preferredDays: string[];
    preferredTime: string | null;
    clientComment: string | null;
    trainerComment: string | null;
    createdAt: Date;
    client: {
      id: string;
      telegramId: string;
      fullName: string;
      username: string | null;
      phone: string | null;
      note: string | null;
      isBlacklisted: boolean;
    };
  }): NoSlotRequestDto {
    return {
      id: item.id,
      status: item.status,
      preferredDays: item.preferredDays,
      preferredTime: item.preferredTime,
      clientComment: item.clientComment,
      trainerComment: item.trainerComment,
      createdAt: item.createdAt.toISOString(),
      client: {
        id: item.client.id,
        telegramId: item.client.telegramId,
        fullName: item.client.fullName,
        username: item.client.username,
        phone: item.client.phone,
        note: item.client.note ?? null,
        isBlacklisted: item.client.isBlacklisted,
      },
    };
  }
}
