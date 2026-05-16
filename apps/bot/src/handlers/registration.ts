import type { Bot, Context } from "grammy";

import { RegistrationService } from "../services/registration-service";
import { UserRole } from "../services/screen-service";

interface RegistrationHandlerDependencies {
  registrationService: RegistrationService;
  resolveRole(userId: number): UserRole;
}

export function registerRegistrationHandler(
  bot: Bot<Context>,
  dependencies: RegistrationHandlerDependencies,
) {
  bot.callbackQuery(/^reg:/, async (context) => {
    const result = await dependencies.registrationService.handleCallback(context, dependencies.resolveRole);

    if (!result.handled) {
      await context.answerCallbackQuery();
    }
  });
}
