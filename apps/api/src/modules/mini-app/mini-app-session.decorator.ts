import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { MiniAppRequest } from "./mini-app-auth.guard";
import { MiniAppSessionPayload } from "./mini-app-auth.types";

export const MiniAppSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MiniAppSessionPayload => {
    const request = context.switchToHttp().getRequest<MiniAppRequest>();
    if (!request.miniAppSession) {
      throw new Error("Mini app session is not attached to request");
    }

    return request.miniAppSession;
  },
);
