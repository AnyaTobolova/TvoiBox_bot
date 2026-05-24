"use client";

import Image from "next/image";
import { startTransition, useEffect, useState } from "react";

import {
  AvailableSlot,
  ClientTrainingDto,
  MiniAppApi,
  MiniAppMeResponse,
  SlotClosureInfo,
  getMiniAppApiBaseUrl,
} from "../lib/mini-app-api";
import { TrainerMiniApp } from "./trainer-mini-app";

type ScreenId = "home" | "booking" | "records" | "profile" | "support";
type AuthMode = "boot" | "dev" | "ready" | "error";

interface DevLoginState {
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
}

interface ProfileFormState {
  fullName: string;
  phone: string;
  note: string;
}

interface NoSlotRequestFormState {
  preferredDays: string[];
  preferredTime: string;
  clientComment: string;
}

const api = new MiniAppApi(getMiniAppApiBaseUrl());
const SESSION_STORAGE_KEY = "tvoy-box-mini-app-token";
const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Понедельник",
  tuesday: "Вторник",
  wednesday: "Среда",
  thursday: "Четверг",
  friday: "Пятница",
  saturday: "Суббота",
  sunday: "Воскресенье",
};

function formatHoursLabel(value: number): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) {
    return `${value} часов`;
  }

  if (last === 1) {
    return `${value} час`;
  }

  if (last >= 2 && last <= 4) {
    return `${value} часа`;
  }

  return `${value} часов`;
}

function formatDaysLabel(value: number): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) {
    return `${value} дней`;
  }

  if (last === 1) {
    return `${value} день`;
  }

  if (last >= 2 && last <= 4) {
    return `${value} дня`;
  }

  return `${value} дней`;
}

function formatDateTime(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateIso));
}

function formatDayLabel(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(dateIso));
}

function formatTime(dateIso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateIso));
}

function getStatusTone(item: ClientTrainingDto): "pending" | "success" | "danger" | "muted" {
  if (item.isAwaitingTrainerDecision || item.hasTrainerProposal) {
    return "pending";
  }

  switch (item.bookingStatus) {
    case "PENDING":
    case "RESCHEDULED":
      return "pending";
    case "CONFIRMED":
      return "success";
    case "CANCELLED":
    case "REJECTED":
      return "danger";
    default:
      return "muted";
  }
}

function getStatusLabel(item: ClientTrainingDto): string {
  if (item.isAwaitingTrainerDecision) {
    return "Ожидает подтверждения";
  }

  if (item.hasTrainerProposal) {
    return "Предложен перенос";
  }

  switch (item.bookingStatus) {
    case "PENDING":
      return "Ожидает подтверждения";
    case "CONFIRMED":
      return "Подтверждено";
    case "RESCHEDULED":
      return "Предложен перенос";
    case "CANCELLED":
      return "Отменено";
    case "REJECTED":
      return "Отклонено";
    case "EXPIRED":
      return "Истекло";
    default:
      return item.bookingStatus;
  }
}

function groupSlotsByDay(slots: AvailableSlot[]) {
  const groups = new Map<string, AvailableSlot[]>();

  for (const slot of slots) {
    const dayKey = slot.startAt.slice(0, 10);
    const current = groups.get(dayKey) ?? [];
    current.push(slot);
    groups.set(dayKey, current);
  }

  return [...groups.entries()].map(([dayKey, items]) => ({
    dayKey,
    title: formatDayLabel(items[0].startAt),
    items: items.sort((left, right) => left.startAt.localeCompare(right.startAt)),
  }));
}

export function MiniAppRoot() {
  const [authMode, setAuthMode] = useState<AuthMode>("boot");
  const [session, setSession] = useState<MiniAppMeResponse | null>(null);
  const [screen, setScreen] = useState<ScreenId>("home");
  const [screenHistory, setScreenHistory] = useState<ScreenId[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [devLogin, setDevLogin] = useState<DevLoginState>({
    telegramId: "",
    username: "",
    firstName: "Демо",
    lastName: "Клиент",
  });
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    fullName: "",
    phone: "",
    note: "",
  });
  const [bookingConsentAccepted, setBookingConsentAccepted] = useState(false);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [closureInfo, setClosureInfo] = useState<SlotClosureInfo | null>(null);
  const [bookingRules, setBookingRules] = useState<{ bookingHorizonDays: number; sameDayBookingCutoff: number } | null>(null);
  const [records, setRecords] = useState<ClientTrainingDto[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [bookingComment, setBookingComment] = useState("");
  const [rescheduleBookingId, setRescheduleBookingId] = useState<string | null>(null);
  const [showNoSlotRequest, setShowNoSlotRequest] = useState(false);
  const [noSlotForm, setNoSlotForm] = useState<NoSlotRequestFormState>({
    preferredDays: [],
    preferredTime: "",
    clientComment: "",
  });

  const slotGroups = groupSlotsByDay(slots);

  const hydrateSession = async (token: string) => {
    api.setToken(token);
    const me = await api.getMe();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    setSession(me);
    setAuthMode("ready");
  };

  const createPreviewSession = async (role: "client" | "trainer") => {
    const createdSession = await api.devLogin(
      role === "trainer"
        ? {
            telegramId: "492732093",
            username: "demo_trainer",
            firstName: "Демо",
            lastName: "Тренер",
          }
        : {
            telegramId: "7000000001",
            username: "demo_client",
            firstName: "Демо",
            lastName: "Клиент",
          },
    );

    await hydrateSession(createdSession.token);
  };

  const bootstrap = async () => {
    try {
      const devMode = new URLSearchParams(window.location.search).get("dev");
      const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      const forceManualDev = devMode === "manual";
      const previewRole = devMode === "trainer" ? "trainer" : devMode === "client" ? "client" : null;
      const canUsePreviewDevLogin = isLocalPreview || Boolean(previewRole);

      if (previewRole && canUsePreviewDevLogin && !forceManualDev) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        await createPreviewSession(previewRole);
        return;
      }

      const savedToken = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (savedToken && !devMode) {
        try {
          await hydrateSession(savedToken);
          return;
        } catch {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }

      const webApp = window.Telegram?.WebApp;
      if (webApp) {
        webApp.ready();
        webApp.expand();
        webApp.setHeaderColor?.("#ffffff");
        webApp.setBackgroundColor?.("#f7f4ef");
      }

      const initData = webApp?.initData?.trim();
      if (!initData) {
        if (previewRole && canUsePreviewDevLogin && !forceManualDev) {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
          await createPreviewSession(previewRole);
          return;
        }

        setAuthMode("dev");
        return;
      }

      const createdSession = await api.createSession(initData);
      await hydrateSession(createdSession.token);
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось инициализировать mini app." });
      setAuthMode("error");
    }
  };

  const loadBookingContext = async () => {
    setIsBusy(true);
    try {
      const [nextSlots, nextClosureInfo, nextRules] = await Promise.all([
        api.getClientSlots(),
        api.getClientClosureInfo(),
        api.getClientBookingRules(),
      ]);
      setSlots(nextSlots);
      setClosureInfo(nextClosureInfo);
      setBookingRules(nextRules.settings);
    } finally {
      setIsBusy(false);
    }
  };

  const loadRecords = async () => {
    setIsBusy(true);
    try {
      const response = await api.getClientTrainings();
      setRecords(response.items);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    setProfileForm({
      fullName: session.profile?.fullName ?? [session.session.firstName, session.session.lastName].filter(Boolean).join(" "),
      phone: session.profile?.phone ?? "",
      note: session.profile?.note ?? "",
    });
    setBookingConsentAccepted(Boolean(session.profile?.consentAcceptedAt));
  }, [session]);

  useEffect(() => {
    if (authMode !== "ready") {
      return;
    }

    if (screen === "booking") {
      void loadBookingContext();
    }

    if (screen === "records") {
      void loadRecords();
    }
  }, [authMode, screen]);

  const openScreen = (nextScreen: ScreenId) => {
    startTransition(() => {
      setScreenHistory((current) => (screen === nextScreen ? current : [...current, screen]));
      setScreen(nextScreen);
    });
  };

  const goBack = () => {
    startTransition(() => {
      if (screen === "booking" && rescheduleBookingId) {
        setRescheduleBookingId(null);
        setSelectedSlotId("");
        setBookingComment("");
      }
      setScreenHistory((current) => {
        const previous = current[current.length - 1] ?? "home";
        setScreen(previous);
        return current.slice(0, -1);
      });
    });
  };

  const handleDevQuickLogin = async () => {
    setIsBusy(true);
    setMessage(null);

    try {
      const createdSession = await api.devLogin({
        telegramId: "7000000001",
        username: "demo_client",
        firstName: "Демо",
        lastName: "Клиент",
      });
      await hydrateSession(createdSession.token);
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Демо-вход не удался." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleManualDevLogin = async () => {
    setIsBusy(true);
    setMessage(null);

    try {
      const createdSession = await api.devLogin(devLogin);
      await hydrateSession(createdSession.token);
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Вход по Telegram ID не удался." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    setIsBusy(true);
    setMessage(null);

    try {
      await api.updateProfile({
        fullName: profileForm.fullName,
        phone: profileForm.phone || null,
        note: profileForm.note || null,
      });
      const me = await api.getMe();
      setSession(me);
      setMessage({ tone: "success", text: "Профиль сохранён. Теперь можно спокойно записываться на тренировку." });
      openScreen("home");
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось сохранить профиль." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleBookingSubmit = async () => {
    if (!selectedSlotId) {
      setMessage({ tone: "error", text: "Сначала выбери дату и время тренировки." });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      if (rescheduleBookingId) {
        await api.rescheduleTraining({
          bookingId: rescheduleBookingId,
          targetSlotId: selectedSlotId,
          clientComment: bookingComment || undefined,
        });
        setMessage({ tone: "success", text: "Запрос на перенос отправлен тренеру." });
        setRescheduleBookingId(null);
        setSelectedSlotId("");
        setBookingComment("");
        openScreen("records");
        await loadRecords();
        return;
      }

      await api.requestBooking({
        slotId: selectedSlotId,
        clientComment: bookingComment || null,
      });
      setMessage({ tone: "success", text: "Запрос тренеру отправлен. Он появится в разделе «Мои записи» со статусом ожидания." });
      setSelectedSlotId("");
      setBookingComment("");
      openScreen("records");
      await loadRecords();
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось отправить заявку." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleNoSlotRequest = async () => {
    if (noSlotForm.preferredDays.length === 0) {
      setMessage({ tone: "error", text: "Выбери хотя бы один удобный день." });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      await api.createNoSlotRequest({
        preferredDays: noSlotForm.preferredDays,
        preferredTime: noSlotForm.preferredTime || null,
        clientComment: noSlotForm.clientComment || null,
      });
      setShowNoSlotRequest(false);
      setNoSlotForm({
        preferredDays: [],
        preferredTime: "",
        clientComment: "",
      });
      setMessage({ tone: "success", text: "Запрос без слота отправлен. Тренер увидит ваши пожелания." });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось отправить запрос без слота." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleCancelTraining = async (bookingId: string) => {
    setIsBusy(true);
    setMessage(null);

    try {
      const response = await api.cancelTraining({ bookingId });
      await loadRecords();
      const successMessage =
        response.status === "confirmed"
          ? "Запрос на перенос отменён."
          : "Заявка или тренировка отменена.";
      setMessage({ tone: "success", text: successMessage });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось отменить заявку или тренировку." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleStartReschedule = (bookingId: string) => {
    setRescheduleBookingId(bookingId);
    setSelectedSlotId("");
    setBookingComment("");
    openScreen("booking");
  };

  const handleOpenBooking = () => {
    setRescheduleBookingId(null);
    setSelectedSlotId("");
    setBookingComment("");
    openScreen("booking");
  };

  const handleAcceptProposal = async (bookingId: string) => {
    setIsBusy(true);
    setMessage(null);

    try {
      await api.acceptProposal({ bookingId });
      await loadRecords();
      setMessage({ tone: "success", text: "Предложенное время принято." });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось принять предложенное время." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeclineProposal = async (bookingId: string) => {
    setIsBusy(true);
    setMessage(null);

    try {
      await api.declineProposal({ bookingId });
      await loadRecords();
      setMessage({ tone: "success", text: "Предложенное время отклонено." });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось отклонить предложенное время." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleArchiveRecord = async (bookingId: string) => {
    setIsBusy(true);
    setMessage(null);

    try {
      await api.archiveClientTraining({ bookingId });
      await loadRecords();
      setMessage({ tone: "success", text: "Запись скрыта из вашего списка." });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось скрыть запись из списка." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDownloadCalendar = async (bookingId: string, startAt: string) => {
    setIsBusy(true);
    setMessage(null);

    try {
      const blob = await api.downloadClientCalendarFile(bookingId);
      const url = URL.createObjectURL(blob);
      const date = new Date(startAt);
      const fileName = `tvoy-box-training-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}.ics`;
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage({ tone: "success", text: "Файл календаря скачан. Внутри уже добавлены напоминания за 1 день и за 1 час." });
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось скачать файл календаря." });
    } finally {
      setIsBusy(false);
    }
  };

  const handleBookingConsentChange = async (nextValue: boolean) => {
    const currentSession = session;
    if (!currentSession) {
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      await api.updateProfile({
        fullName: profileForm.fullName.trim() || [currentSession.session.firstName, currentSession.session.lastName].filter(Boolean).join(" "),
        phone: profileForm.phone || null,
        note: profileForm.note || null,
        consentAccepted: nextValue,
      });
      const me = await api.getMe();
      setSession(me);
      setBookingConsentAccepted(nextValue);
    } catch (error) {
      const normalizedError = error as Error;
      setMessage({ tone: "error", text: normalizedError.message || "Не удалось обновить согласие на обработку данных." });
    } finally {
      setIsBusy(false);
    }
  };

  if (authMode === "boot") {
    return (
      <main className="mini-app-page">
        <div className="mini-app-shell">
          <div className="loader-state">
            <strong>Запускаем mini app…</strong>
            <span>Проверяем Telegram-сессию и подготавливаем ваш экран записи.</span>
          </div>
        </div>
      </main>
    );
  }

  if (authMode === "dev" || authMode === "error") {
    return (
      <main className="mini-app-page">
        <section className="dev-panel">
          <Image src="/assets/logo-mark.png" alt="Знак Твой Бокс" width={112} height={112} />
          <div className="brand-lockup brand-lockup-center">
            <span className="brand-title">
              <span className="brand-title-main">ТВОЙ</span>
              <span className="brand-title-accent">БОКС</span>
            </span>
            <span className="brand-tagline">Твой путь к силе и уверенности</span>
          </div>
          <p>{authMode === "error" ? "Открой mini app из Telegram, чтобы войти как клиент или тренер." : "Локально открываем интерфейс в безопасном режиме для просмотра и согласования экранов."}</p>

          {message ? (
            <div className={`alert ${message.tone === "error" ? "alert-error" : "alert-info"}`}>
              <div>
                <strong>{message.tone === "error" ? "Есть проблема" : "Подсказка"}</strong>
                <p>{message.text}</p>
              </div>
            </div>
          ) : null}

          <div className="dev-actions">
            <button className="primary-button" disabled={isBusy} onClick={() => void handleDevQuickLogin()}>
              Открыть клиентский экран
            </button>
          </div>

          <details className="debug-details">
            <summary className="debug-summary">Технический вход для локальной проверки</summary>
            <div className="dev-form form-grid">
              <div className="field">
                <label className="field-label" htmlFor="dev-telegram-id">
                  Telegram ID
                </label>
                <input
                  id="dev-telegram-id"
                  value={devLogin.telegramId}
                  onChange={(event) => setDevLogin((current) => ({ ...current, telegramId: event.target.value }))}
                  placeholder="Например, ваш реальный Telegram ID"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="dev-first-name">
                  Имя
                </label>
                <input
                  id="dev-first-name"
                  value={devLogin.firstName}
                  onChange={(event) => setDevLogin((current) => ({ ...current, firstName: event.target.value }))}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="dev-last-name">
                  Фамилия
                </label>
                <input
                  id="dev-last-name"
                  value={devLogin.lastName}
                  onChange={(event) => setDevLogin((current) => ({ ...current, lastName: event.target.value }))}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="dev-username">
                  Username
                </label>
                <input
                  id="dev-username"
                  value={devLogin.username}
                  onChange={(event) => setDevLogin((current) => ({ ...current, username: event.target.value }))}
                  placeholder="@username"
                />
              </div>

              <p className="helper-note">
                Если понадобится проверить тренерский режим локально, можно ввести реальный `ADMIN_TELEGRAM_ID` из `.env`.
              </p>

              <button className="secondary-button" disabled={isBusy} onClick={() => void handleManualDevLogin()}>
                Войти по введённому Telegram ID
              </button>
            </div>
          </details>
        </section>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  const isTrainer = session.session.role === "trainer";

  if (isTrainer) {
    return <TrainerMiniApp api={api} session={session} />;
  }

  return (
    <main className="mini-app-page">
      <div className="mini-app-shell">
        <header className={`topbar${screen !== "home" ? " topbar-subpage" : ""}`}>
          <div className="brand">
            <Image className="brand-logo" src="/assets/logo-mark.png" alt="Знак Твой Бокс" width={52} height={52} />
            <div className="brand-copy">
              <span className="brand-title">
                <span className="brand-title-main">ТВОЙ</span>
                <span className="brand-title-accent">БОКС</span>
              </span>
              <span className="brand-tagline">Твой путь к силе и уверенности</span>
            </div>
          </div>

          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Профиль"
              title="Профиль"
              data-tooltip="Профиль"
              onClick={() => openScreen("profile")}
            >
              П
            </button>
            <button
              className="icon-button"
              aria-label="Помощь"
              title="Помощь"
              data-tooltip="Помощь"
              onClick={() => openScreen("support")}
            >
              ?
            </button>
          </div>
        </header>

        {message ? (
          <div className={`alert ${message.tone === "success" ? "alert-success" : message.tone === "error" ? "alert-error" : "alert-info"}`}>
            <div>
              <strong>
                {message.tone === "success" ? "Готово" : message.tone === "error" ? "Есть проблема" : "Подсказка"}
              </strong>
              <p>{message.text}</p>
            </div>
            <button className="link-button" onClick={() => setMessage(null)}>
              Скрыть
            </button>
          </div>
        ) : null}

        {screen === "home" ? (
          <>
            <section className="hero-card">
              <div className="hero-grid">
                <div className="hero-copy">
                  <h1 className="hero-title hero-title-brand">
                    <span className="hero-title-line">Сила начинается не с удара.</span>
                    <span className="hero-title-line">Сила начинается</span>
                    <span className="hero-title-line">с уверенности в себе.</span>
                  </h1>
                  <p className="hero-lead hero-lead-brand">
                    Выберите удобный день, отправьте заявку и приходите на тренировку. Без давления, без подготовки,
                    просто попробуйте.
                  </p>
                </div>

                <aside className="hero-aside">
                  <div className="trainer-frame">
                    <Image className="trainer-photo" src="/assets/trainer.png" alt="Тренер Твой Бокс" width={800} height={1000} priority />
                  </div>
                </aside>
              </div>
            </section>

            {session.needsProfileCompletion ? (
              <div className="alert alert-info">
                <div>
                  <strong>Можно сразу заполнить профиль</strong>
                  <p>Имя, телефон и заметка помогут тренеру быстрее связаться с вами при записи.</p>
                </div>
                <button className="secondary-button" onClick={() => openScreen("profile")}>
                  Открыть профиль
                </button>
              </div>
            ) : null}

            <section className="home-actions-grid">
              <article className="action-card action-card-home">
                <strong>Запись</strong>
                <p>Открой свободные слоты, выбери удобное время и отправь заявку.</p>
                <button
                  className="primary-button"
                  disabled={isBusy}
                  onClick={handleOpenBooking}
                >
                  Перейти к слотам
                </button>
              </article>

              <article className="action-card action-card-home">
                <strong>Мои тренировки</strong>
                <p>Проверяй будущие записи, переноси время или отменяй тренировку.</p>
                <button className="secondary-button" disabled={isBusy} onClick={() => openScreen("records")}>
                  Открыть список
                </button>
              </article>
              <article className="action-card action-card-home">
                <strong>РЎРІСЏР·СЊ СЃ С‚СЂРµРЅРµСЂРѕРј</strong>
                <p>Р•СЃР»Рё РµСЃС‚СЊ РІРѕРїСЂРѕСЃ РёР»Рё С…РѕС‡РµС€СЊ С‡С‚Рѕ-С‚Рѕ РѕР±СЃСѓРґРёС‚СЊ, РјРѕР¶РЅРѕ РЅР°РїРёСЃР°С‚СЊ РЅР°РїСЂСЏРјСѓСЋ РІ Telegram.</p>
                <a className="secondary-button support-link-button" href="https://t.me/RostPV" target="_blank" rel="noreferrer">
                  Написать тренеру
                </a>
              </article>
            </section>

            <section className="panel compact-panel support-panel-hidden">
              <div>
                <h2 className="panel-title">Связь с тренером</h2>
                <p className="panel-text">Если есть какой-то вопрос или хочешь что-то обсудить, то можешь просто написать мне.</p>
              </div>
              <div className="record-actions">
                <a className="secondary-button support-link-button" href="https://t.me/RostPV" target="_blank" rel="noreferrer">
                  Написать тренеру
                </a>
              </div>
            </section>
          </>
        ) : null}

        {screen === "profile" ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Профиль</h2>
                <p className="panel-text">Заполни данные для связи и быстрой записи.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">Имя</span>
                <input
                  value={profileForm.fullName}
                  onChange={(event) => setProfileForm((current) => ({ ...current, fullName: event.target.value }))}
                  placeholder="Как к вам обращаться"
                />
              </label>

              <label className="field">
                <span className="field-label">Телефон</span>
                <input
                  value={profileForm.phone}
                  onChange={(event) => setProfileForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+7..."
                />
              </label>

              <label className="field">
                <span className="field-label">Заметка для тренера</span>
                <textarea
                  value={profileForm.note}
                  onChange={(event) => setProfileForm((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Например: удобно писать после 18:00, есть ограничения по времени, предпочитаю утро и т.д."
                />
              </label>

              <div className="record-actions">
                <button className="primary-button" disabled={isBusy} onClick={() => void handleSaveProfile()}>
                  Сохранить профиль
                </button>
                <button className="secondary-button" disabled={isBusy} onClick={goBack}>
                  Назад
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {screen === "support" ? (
          <section className="panel">
            <div className="panel-header">
              <div className="panel-header-actions">
                <button className="secondary-button" disabled={isBusy} onClick={goBack}>
                  Назад
                </button>
              </div>
              <div>
                <h2 className="panel-title">Помощь</h2>
                <p className="panel-text">Коротко о записи и связи с тренером.</p>
              </div>
            </div>

            <ul className="support-list">
              <li>Если подходящего времени нет, отправь запрос без слота с удобными днями и временем.</li>
              <li>Все актуальные статусы по заявкам и тренировкам собраны в разделе «Мои записи».</li>
              <li>Для связи с тренером лучше заранее заполнить имя, телефон и заметку в профиле.</li>
            </ul>

            <div className="support-contact">
              <p className="panel-text">Если есть какой-то вопрос или хочешь что-то обсудить, то можешь просто написать мне.</p>
              <a className="secondary-button support-link-button" href="https://t.me/RostPV" target="_blank" rel="noreferrer">
                Написать тренеру
              </a>
            </div>
          </section>
        ) : null}

        {screen === "booking" ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">{rescheduleBookingId ? "Перенос записи" : "Запись на тренировку"}</h2>
                {bookingRules ? (
                  <p className="panel-text">
                    Запись открыта на {formatDaysLabel(bookingRules.bookingHorizonDays)} вперёд.
                    {bookingRules.sameDayBookingCutoff > 0
                      ? ` В день тренировки запись закрывается за ${formatHoursLabel(bookingRules.sameDayBookingCutoff)} до начала.`
                      : " В день тренировки запись доступна до начала занятия."}
                  </p>
                ) : null}
              </div>
              <button className="secondary-button" disabled={isBusy} onClick={goBack}>
                Назад
              </button>
            </div>

            <label className="checkbox-row checkbox-row-panel">
              <input
                type="checkbox"
                checked={bookingConsentAccepted}
                disabled={isBusy}
                onChange={(event) => void handleBookingConsentChange(event.target.checked)}
              />
              <span>Подтверждаю согласие на обработку персональных данных для записи на тренировку.</span>
            </label>
            {!bookingConsentAccepted ? (
              <p className="consent-note">После подтверждения согласия можно выбрать дату и время тренировки.</p>
            ) : null}

            {closureInfo?.hasClosure ? (
              <div className="alert alert-info">
                <div>
                  <strong>Часть слотов сейчас закрыта</strong>
                  <p>{closureInfo.reason || "Тренер временно закрыл часть времени для записи."}</p>
                </div>
              </div>
            ) : null}

            {isBusy && slotGroups.length === 0 ? (
              <div className="loader-state">
                <strong>Подгружаем доступные слоты…</strong>
                <span>Собираем ближайшее свободное время по текущим настройкам записи.</span>
              </div>
            ) : null}

            {!isBusy && slotGroups.length === 0 ? (
              <div className="empty-state">
                <strong>Свободных слотов пока нет</strong>
                <span>Можно сразу отправить запрос без слота и указать удобные дни.</span>
                <button className="secondary-button" onClick={() => setShowNoSlotRequest(true)}>
                  Открыть запрос без слота
                </button>
              </div>
            ) : null}

            {slotGroups.length > 0 ? (
              <div className="booking-groups">
                {slotGroups.map((group) => (
                  <section className="slot-day" key={group.dayKey}>
                    <div className="slot-day-header">
                      <h3 className="slot-day-title">{group.title}</h3>
                    </div>
                    <div className="time-grid">
                      {group.items.map((slot) => (
                        <button
                          key={slot.id}
                          className="time-button"
                          data-active={selectedSlotId === slot.id}
                          disabled={!bookingConsentAccepted}
                          onClick={() => setSelectedSlotId(slot.id)}
                        >
                          {formatTime(slot.startAt)}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}

            <div className="form-grid" style={{ marginTop: 16 }}>
              <label className="field">
                <span className="field-label">Комментарий к заявке</span>
                <textarea
                  value={bookingComment}
                  onChange={(event) => setBookingComment(event.target.value)}
                  placeholder="Например: мне удобнее закончить до 19:00 или нужно время чуть позже."
                />
              </label>

              <div className="record-actions">
                <button
                  className="primary-button"
                  disabled={isBusy || !selectedSlotId || !bookingConsentAccepted}
                  onClick={() => void handleBookingSubmit()}
                >
                  {rescheduleBookingId ? "Отправить запрос на перенос" : "Отправить заявку"}
                </button>
                <button className="secondary-button" disabled={isBusy} onClick={() => setShowNoSlotRequest((current) => !current)}>
                  {showNoSlotRequest ? "Скрыть запрос без слота" : "Нет подходящего времени"}
                </button>
              </div>
            </div>

            {showNoSlotRequest ? (
              <section className="panel" style={{ marginTop: 16, padding: 16 }}>
                <div className="panel-header">
                  <div>
                    <h3 className="panel-title">Запрос без слота</h3>
                    <p className="panel-text">Укажи удобные дни и время, чтобы тренер смог предложить вариант вручную.</p>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="field">
                    <span className="field-label">Удобные дни</span>
                    <div className="chip-group">
                      {Object.entries(WEEKDAY_LABELS).map(([value, label]) => {
                        const active = noSlotForm.preferredDays.includes(value);
                        return (
                          <button
                            key={value}
                            className="chip-button"
                            data-active={active}
                            onClick={() =>
                              setNoSlotForm((current) => ({
                                ...current,
                                preferredDays: active
                                  ? current.preferredDays.filter((item) => item !== value)
                                  : [...current.preferredDays, value],
                              }))
                            }
                            type="button"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="field">
                    <span className="field-label">Предпочтительное время</span>
                    <input
                      value={noSlotForm.preferredTime}
                      onChange={(event) => setNoSlotForm((current) => ({ ...current, preferredTime: event.target.value }))}
                      placeholder="Например: после 19:00 или утром"
                    />
                  </label>

                  <label className="field">
                    <span className="field-label">Комментарий</span>
                    <textarea
                      value={noSlotForm.clientComment}
                      onChange={(event) => setNoSlotForm((current) => ({ ...current, clientComment: event.target.value }))}
                      placeholder="Опиши удобные окна, если это поможет быстрее подобрать время."
                    />
                  </label>

                  <button className="primary-button" disabled={isBusy} onClick={() => void handleNoSlotRequest()}>
                    Отправить запрос
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {screen === "records" ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Мои записи</h2>
                <p className="panel-text">Здесь собраны только будущие записи и актуальные статусы по ним.</p>
              </div>
              <div className="panel-header-actions">
                <button className="secondary-button" disabled={isBusy} onClick={goBack}>
                  Назад
                </button>
                <button className="secondary-button" disabled={isBusy} onClick={() => void loadRecords()}>
                  Обновить
                </button>
              </div>
            </div>

            {isBusy && records.length === 0 ? (
              <div className="loader-state">
                <strong>Загружаем записи…</strong>
                <span>Проверяем подтверждения, переносы и доступные действия.</span>
              </div>
            ) : null}

            {!isBusy && records.length === 0 ? (
              <div className="empty-state">
                <strong>Пока нет будущих записей</strong>
                <span>Когда будешь готов, можно сразу вернуться к выбору слота.</span>
                <button className="primary-button" onClick={handleOpenBooking}>
                  Перейти к записи
                </button>
              </div>
            ) : null}

            {records.length > 0 ? (
              <div className="record-list">
                {records.map((item) => (
                  <article className="record-card" key={item.bookingId}>
                    <div className="record-card-head">
                      <div>
                        <h3 className="record-title">{formatDateTime(item.startAt)}</h3>
                      </div>
                      <span className="status-pill" data-tone={getStatusTone(item)}>
                        {getStatusLabel(item)}
                      </span>
                    </div>

                    {item.trainerComment ? <p className="record-comment">Комментарий тренера: {item.trainerComment}</p> : null}
                    {item.clientComment ? <p className="record-comment">Ваш комментарий: {item.clientComment}</p> : null}

                    <div className="record-actions">
                      {item.canReschedule ? (
                        <button className="status-button" disabled={isBusy} onClick={() => handleStartReschedule(item.bookingId)}>
                          Перенести
                        </button>
                      ) : null}
                      {item.canCancel ? (
                        <button
                          className="status-button"
                          data-variant="danger"
                          disabled={isBusy}
                          onClick={() => void handleCancelTraining(item.bookingId)}
                        >
                          {item.isAwaitingTrainerDecision ? "Отменить заявку" : "Отменить"}
                        </button>
                      ) : null}
                      {item.hasTrainerProposal ? (
                        <>
                          <button className="status-button" disabled={isBusy} onClick={() => void handleAcceptProposal(item.bookingId)}>
                            Принять перенос
                          </button>
                          <button className="status-button" disabled={isBusy} onClick={() => void handleDeclineProposal(item.bookingId)}>
                            Отклонить перенос
                          </button>
                        </>
                      ) : null}
                      {item.trainingStatus && item.trainingStatus !== "CANCELLED" && !item.isAwaitingTrainerDecision ? (
                        <button className="status-button" disabled={isBusy} onClick={() => void handleDownloadCalendar(item.bookingId, item.startAt)}>
                          Добавить в календарь
                        </button>
                      ) : null}
                      {item.canDelete ? (
                        <button className="status-button" disabled={isBusy} onClick={() => void handleArchiveRecord(item.bookingId)}>
                          Удалить из списка
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
