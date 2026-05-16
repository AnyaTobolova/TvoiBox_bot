import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { NoSlotRequestStatus } from "@prisma/client";

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
  };
}

export interface CreateNoSlotRequestResult {
  status: "created";
  request: NoSlotRequestDto;
}

@Injectable()
export class NoSlotRequestsService {
  constructor(private readonly prismaService: PrismaService) {}

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
        },
      },
    };
  }
}

