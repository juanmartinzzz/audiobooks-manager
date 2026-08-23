import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppPasswordBar, AppPasswordProvider } from "./components/AppPasswordBar";
import { AudiobookPage } from "./pages/AudiobookPage";
import { LibraryPage } from "./pages/LibraryPage";

export default function App() {
  return (
    <AppPasswordProvider>
      <BrowserRouter>
        <AppPasswordBar />
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/audiobooks/:id" element={<AudiobookPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppPasswordProvider>
  );
}
