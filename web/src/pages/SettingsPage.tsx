import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAppPassword } from "../components/AppPasswordProvider";
import { SectionsCard, type SectionsCardSection } from "../components/interaction/SectionsCard";
import { TextInput } from "../components/interaction/TextInput";

export function SettingsPage() {
  const { password, setPassword } = useAppPassword();
  const saved = password.trim().length > 0;

  const sections: SectionsCardSection[] = [
    {
      id: "password",
      title: "Password",
      description: "The public Worker rejects every request without this.",
      columnWidths: "minmax(12rem, 28rem)",
      columns: [
        <TextInput
          key="password"
          id="settings-password"
          label="API password"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          help={saved ? "Saved on this device." : "Not set on this device yet."}
        />,
      ],
    },
  ];

  return (
    <>
      <header className="top">
        <div className="wrap header-row">
          <div>
            <Link className="back-link" to="/">
              <ArrowLeft size={16} />
              Library
            </Link>
            <p className="brand-eyebrow">Audiobooks Manager</p>
            <h1 className="brand-title">Settings</h1>
            <p className="brand-sub">Device-only. Set this once, then this browser remembers it.</p>
          </div>
        </div>
      </header>

      <main className="wrap">
        <SectionsCard
          id="settings.access"
          title={<h2 className="library-create-title">Access</h2>}
          meta="Kept in local storage on this browser. Not in the Worker source."
          sections={sections}
        />
      </main>
    </>
  );
}
