import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { TextInput } from "./interaction/TextInput";
import { loadAppPassword, saveAppPassword } from "../lib/appPassword";

type AppPasswordContextValue = {
  password: string;
  activePassword: string;
  setPassword: (password: string) => void;
};

const AppPasswordContext = createContext<AppPasswordContextValue | null>(null);

export function AppPasswordProvider({ children }: { children: ReactNode }) {
  const [password, setPasswordState] = useState(loadAppPassword);
  const [activePassword, setActivePassword] = useState(loadAppPassword);

  useEffect(() => {
    const handle = window.setTimeout(() => setActivePassword(password), 400);
    return () => window.clearTimeout(handle);
  }, [password]);

  const setPassword = useCallback((next: string) => {
    setPasswordState(next);
    saveAppPassword(next);
  }, []);

  const value = useMemo(
    () => ({ password, activePassword, setPassword }),
    [password, activePassword, setPassword],
  );

  return <AppPasswordContext.Provider value={value}>{children}</AppPasswordContext.Provider>;
}

export function useAppPassword(): AppPasswordContextValue {
  const value = useContext(AppPasswordContext);
  if (!value) throw new Error("useAppPassword must be used within AppPasswordProvider");
  return value;
}

export function AppPasswordBar() {
  const { password, setPassword } = useAppPassword();

  return (
    <div className="app-password-bar">
      <div className="wrap app-password-bar-inner">
        <TextInput
          id="app-password"
          className="app-password-field"
          label="Password"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          help="Saved on this device. Needed for every request."
        />
      </div>
    </div>
  );
}
