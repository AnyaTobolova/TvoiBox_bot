export type CalendarOpenMode = "opened" | "downloaded";

function isTelegramMobileWebView(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = window.navigator.userAgent || "";
  return /Telegram/i.test(userAgent) && /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function openCalendarFile(blob: Blob, fileName: string): CalendarOpenMode {
  const url = window.URL.createObjectURL(blob);
  const releaseUrl = () => {
    window.setTimeout(() => {
      window.URL.revokeObjectURL(url);
    }, 60_000);
  };

  if (isTelegramMobileWebView()) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.type = "text/calendar";
    document.body.appendChild(link);
    link.click();
    link.remove();
    releaseUrl();
    return "opened";
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  releaseUrl();
  return "downloaded";
}
