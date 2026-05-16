import { buildScreenKeyboard, getScreenText, ScreenId, UserRole } from "../services/screen-service";

export function buildScreenView(screenId: ScreenId, role: UserRole) {
  return {
    text: getScreenText(screenId, role),
    keyboard: buildScreenKeyboard(screenId, role),
  };
}
