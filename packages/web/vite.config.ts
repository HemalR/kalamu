import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    // The local server owns /assets/* for pasted images (.kalamu/assets/);
    // keep the app bundle out of its way.
    assetsDir: "app",
  },
  server: {
    // `pnpm dev` workflow: run `kalamu open --no-browser` (port 4242) alongside vite.
    proxy: {
      "/api": "http://127.0.0.1:4242",
      "/assets": "http://127.0.0.1:4242",
    },
  },
});
