import type { Bot, Context } from "grammy";

import { NoSlotRequestService } from "../services/no-slot-request-service";

interface NoSlotRequestHandlerDependencies {
  noSlotRequestService: NoSlotRequestService;
}

export function registerNoSlotRequestHandler(
  bot: Bot<Context>,
  dependencies: NoSlotRequestHandlerDependencies,
) {
  bot.callbackQuery(/^noslot:/, async (context) => {
    const result = await dependencies.noSlotRequestService.handleCallback(context);

    if (!result.handled) {
      await context.answerCallbackQuery();
    }
  });
}

