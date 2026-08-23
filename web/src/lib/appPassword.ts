const STORAGE_KEY = "audiobooks.app-password.v1";

export function loadAppPassword(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAppPassword(password: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, password);
  } catch {
    // ignore quota / private mode
  }
}
