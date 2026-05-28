import { InlineKeyboard } from "grammy";

const CLIENT_MINI_APP_LABEL = "Открыть mini app";

export function normalizeMiniAppUrl(rawUrl: string): string {
  const normalizedUrl = rawUrl.trim();
  if (!normalizedUrl) {
    return "";
  }

  try {
    const parsed = new URL(normalizedUrl);
    const devMode = parsed.searchParams.get("dev");
    if (devMode === "client" || devMode === "trainer" || devMode === "manual") {
      parsed.searchParams.delete("dev");
    }
    return parsed.toString();
  } catch {
    return normalizedUrl;
  }
}

export function buildClientMiniAppInlineKeyboard(miniAppUrl: string): InlineKeyboard | null {
  const normalizedUrl = normalizeMiniAppUrl(miniAppUrl);
  if (!normalizedUrl) {
    return null;
  }

  return new InlineKeyboard().webApp(CLIENT_MINI_APP_LABEL, normalizedUrl);
}

export function getClientMiniAppLabel(): string {
  return CLIENT_MINI_APP_LABEL;
}
