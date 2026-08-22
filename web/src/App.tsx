import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AudiobookPage } from "./pages/AudiobookPage";
import { LibraryPage } from "./pages/LibraryPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/audiobooks/:id" element={<AudiobookPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
