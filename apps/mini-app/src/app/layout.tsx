import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Твой Бокс",
  description: "Mini App проекта записи на тренировки «Твой Бокс».",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js?57" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
