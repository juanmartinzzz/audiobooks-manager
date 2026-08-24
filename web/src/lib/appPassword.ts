const STORAGE_KEY = "audiobooks.app-password.v1";

function localDevPassword(): string {
  if (!import.meta.env.DEV) return "";
  const fromEnv = import.meta.env.VITE_APP_PASSWORD;
  return typeof fromEnv === "string" ? fromEnv.trim() : "";
}

export function loadAppPassword(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const fallback = localDevPassword();
    if (fallback) {
      window.localStorage.setItem(STORAGE_KEY, fallback);
      return fallback;
    }
  } catch {
    return "";
  }
  return "";
}

export function saveAppPassword(password: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, password);
  } catch {
    // ignore quota / private mode
  }
}
