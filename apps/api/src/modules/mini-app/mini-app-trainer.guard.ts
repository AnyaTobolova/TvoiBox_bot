import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

import { MiniAppRequest } from "./mini-app-auth.guard";

@Injectable()
export class MiniAppTrainerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<MiniAppRequest>();
    const session = request.miniAppSession;

    if (!session) {
      throw new ForbiddenException("Mini app session is required");
    }

    if (session.role !== "trainer") {
      throw new ForbiddenException("Trainer access is required");
    }

    return true;
  }
}
