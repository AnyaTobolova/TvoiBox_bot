import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Твой Бокс",
  description: "Mini App проекта записи на тренировки «Твой Бокс».",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
