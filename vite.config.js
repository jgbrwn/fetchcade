import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 4096,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});
