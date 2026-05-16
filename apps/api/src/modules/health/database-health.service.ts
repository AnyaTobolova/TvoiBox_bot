import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly prismaService: PrismaService) {}

  async ping() {
    try {
      await this.prismaService.$queryRaw`SELECT 1`;
    } catch (error) {
      const normalizedError = error as Error & { code?: string };

      throw new ServiceUnavailableException({
        status: "error",
        message: normalizedError.message,
        code: normalizedError.code ?? null,
      });
    }

    return {
      status: "ok",
    };
  }
}
