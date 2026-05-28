import type { Metadata } from "next";
import Script from "next/script";
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
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js?57" strategy="beforeInteractive" />
        <Script
          id="telegram-webapp-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var attempts = 0;
                var maxAttempts = 120;
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

                if (document.readyState === "loading") {
                  document.addEventListener("DOMContentLoaded", notifyTelegramReady, { once: true });
                } else {
                  notifyTelegramReady();
                }
              })();
            `,
          }}
        />
        {children}
      </body>
    </html>
  );
}
