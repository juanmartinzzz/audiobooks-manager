import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppPasswordProvider } from "./components/AppPasswordProvider";
import { AudiobookPage } from "./pages/AudiobookPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <AppPasswordProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/audiobooks/:id" element={<AudiobookPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppPasswordProvider>
  );
}
