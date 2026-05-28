import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Твой Бокс",
  description: "Mini App проекта записи на тренировки «Твой Бокс».",
  icons: {
    icon: [
      { url: "/assets/logo-mark.png", type: "image/png" },
    ],
    apple: [
      { url: "/assets/logo-mark.png", type: "image/png" },
    ],
    shortcut: ["/assets/logo-mark.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script src="/vendor/telegram-web-app.js?v=57" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__TVOY_BOX_CLIENT_BOOTED = false;
              (function () {
                var attempts = 0;
                var maxAttempts = 240;
                var delay = 50;

                function notifyTelegramReady() {
                  var webApp = window.Telegram && window.Telegram.WebApp;
                  if (!webApp) {
                    if (attempts < maxAttempts) {
                      attempts += 1;
                      window.setTimeout(notifyTelegramReady, delay);
                    }
                    return;
                  }

                  try {
                    webApp.ready();
                  } catch (error) {}

                  try {
                    webApp.expand();
                  } catch (error) {}
                }

                function showBootstrapFallback() {
                  if (window.__TVOY_BOX_CLIENT_BOOTED) {
                    return;
                  }

                  var loaderState = document.querySelector(".loader-state");
                  if (!loaderState) {
                    return;
                  }

                  loaderState.innerHTML =
                    "<strong>Mini app загружается дольше обычного</strong>" +
                    "<span>Закройте экран и откройте mini app ещё раз из Telegram. Если не поможет, обновите Telegram на телефоне.</span>";
                }

                if (document.readyState === "loading") {
                  document.addEventListener("DOMContentLoaded", notifyTelegramReady, { once: true });
                } else {
                  notifyTelegramReady();
                }

                window.setTimeout(showBootstrapFallback, 8000);
              })();
            `,
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
