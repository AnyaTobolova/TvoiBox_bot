import { InlineKeyboard } from "grammy";

export type UserRole = "client" | "admin";

export type ScreenId =
  | "client-main"
  | "client-intro"
  | "client-booking"
  | "client-trainings"
  | "client-no-slot"
  | "admin-main"
  | "admin-requests"
  | "admin-slots"
  | "admin-settings";

const clientScreenIds: ScreenId[] = [
  "client-main",
  "client-intro",
  "client-booking",
  "client-trainings",
  "client-no-slot",
];

const adminScreenIds: ScreenId[] = ["admin-main", "admin-requests", "admin-slots", "admin-settings"];

export function getRootScreen(role: UserRole): ScreenId {
  return role === "admin" ? "admin-main" : "client-main";
}

export function canAccessScreen(role: UserRole, screenId: ScreenId): boolean {
  return role === "admin"
    ? adminScreenIds.includes(screenId)
    : clientScreenIds.includes(screenId);
}

export function getScreenText(screenId: ScreenId, role: UserRole): string {
  switch (screenId) {
    case "client-main":
      return [
        "Главное меню ТвойБокс.",
        "",
        "Выберите действие кнопкой ниже.",
        "Записаться - открыть даты и время.",
        "Мои тренировки - посмотреть и управлять своими записями.",
        "О боте - заново открыть приветствие и краткую подсказку.",
      ].join("\n");
    case "client-intro":
      return [
        "ТвойБокс.",
        "",
        "ТвойБокс - твой путь к силе и уверенности.",
        "Этот бот нужен для записи на индивидуальные тренировки к тренеру Ростиславу.",
        "",
        "Здесь можно:",
        "записаться на тренировку,",
        "посмотреть свои тренировки,",
        "быстро вернуться в главное меню.",
      ].join("\n");
    case "client-booking":
      return [
        "Запись на тренировку.",
        "",
        "Загружаю доступные даты и время...",
      ].join("\n");
    case "client-trainings":
      return [
        "Мои тренировки.",
        "",
        "Загружаю ваши записи...",
      ].join("\n");
    case "client-no-slot":
      return [
        "Нет подходящего времени.",
        "",
        "Выбери удобные даты и время кнопками ниже, и я передам запрос тренеру.",
      ].join("\n");
    case "admin-main":
      return [
        "Панель тренера.",
        role === "admin" ? "Режим: тренер / администратор" : "Режим: клиент",
        "",
        "Здесь собраны быстрые переходы в заявки и настройки.",
      ].join("\n");
    case "admin-requests":
      return [
        "Раздел заявок.",
        "",
        "Здесь отображаются заявки клиентов и действия по ним.",
      ].join("\n");
    case "admin-slots":
      return [
        "Раздел слотов и доступности.",
        "",
        "Здесь можно управлять датами, часами и периодами записи.",
      ].join("\n");
    case "admin-settings":
      return [
        "Раздел настроек тренера.",
        "",
        "Здесь находятся рабочие настройки записи и поиска клиентов.",
      ].join("\n");
  }
}

export function buildScreenKeyboard(screenId: ScreenId, role: UserRole): InlineKeyboard {
  switch (screenId) {
    case "client-main":
      return new InlineKeyboard()
        .text("Записаться", "screen:client-booking")
        .row()
        .text("Мои тренировки", "screen:client-trainings")
        .row()
        .text("О боте", "screen:client-intro");
    case "client-intro":
      return new InlineKeyboard()
        .text("Открыть меню", "screen:client-main")
        .row()
        .text("Записаться", "screen:client-booking")
        .row()
        .text("Мои тренировки", "screen:client-trainings");
    case "client-booking":
      return new InlineKeyboard().text("Назад", "nav:back");
    case "client-trainings":
      return new InlineKeyboard()
        .text("Записаться", "screen:client-booking")
        .row()
        .text("В клиентское меню", "screen:client-main")
        .row()
        .text("Назад", "nav:back");
    case "client-no-slot":
      return new InlineKeyboard().text("Назад", "nav:back");
    case "admin-main":
      return new InlineKeyboard()
        .text("Заявки", "screen:admin-requests")
        .row()
        .text("Слоты", "screen:admin-slots")
        .row()
        .text("Настройки", "screen:admin-settings");
    case "admin-requests":
    case "admin-slots":
    case "admin-settings":
      return new InlineKeyboard().text("Назад", "nav:back");
  }
}
