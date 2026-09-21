import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:8787",
      "/oauth2callback": "http://localhost:8787",
      "/api": "http://localhost:8787",
      "/logout": "http://localhost:8787"
    }
  },
  build: {
    target: "baseline-widely-available",
    sourcemap: false
  }
});