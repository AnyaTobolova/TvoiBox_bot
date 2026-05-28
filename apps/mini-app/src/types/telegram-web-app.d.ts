export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        version?: string;
        isVersionAtLeast?: (version: string) => boolean;
        colorScheme?: "light" | "dark";
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        openLink?: (url: string) => void;
      };
    };
  }
}
