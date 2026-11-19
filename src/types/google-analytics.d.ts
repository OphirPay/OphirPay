export {};

declare global {
  interface Window {
    gtag?: (
      command: "event" | "config",
      target: string | undefined,
      parameters?: Record<string, string | number | boolean | undefined>
    ) => void;
  }
}
