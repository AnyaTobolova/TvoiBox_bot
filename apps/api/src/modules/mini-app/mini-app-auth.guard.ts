import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

import { MiniAppAuthService } from "./mini-app-auth.service";
import { MiniAppSessionPayload } from "./mini-app-auth.types";

export interface MiniAppRequest {
  headers: Record<string, string | string[] | undefined>;
  miniAppSession?: MiniAppSessionPayload;
}

@Injectable()
export class MiniAppAuthGuard implements CanActivate {
  constructor(private readonly miniAppAuthService: MiniAppAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<MiniAppRequest>();
    const authorizationHeader = request.headers.authorization;
    const authorization = Array.isArray(authorizationHeader)
      ? authorizationHeader[0]?.trim() ?? ""
      : authorizationHeader?.trim() ?? "";

    if (!authorization.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing Bearer token");
    }

    const token = authorization.slice("Bearer ".length);
    request.miniAppSession = this.miniAppAuthService.verifySessionToken(token);
    return true;
  }
}
