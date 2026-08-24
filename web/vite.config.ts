import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, "..", "");
  const localPassword = command === "serve" ? (env.APP_PASSWORD ?? "") : "";

  return {
    plugins: [react()],
    envDir: "..",
    define: {
      "import.meta.env.VITE_APP_PASSWORD": JSON.stringify(localPassword),
    },
    server: {
      port: 27183,
      strictPort: true,
    },
  };
});
