/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Tauri expects a fixed port and wants Rust errors left visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/test-files/**", "**/bench-output/**"] },
  },
  build: {
    target: "es2023",
    sourcemap: false,
  },
  test: {
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
    environment: "node",
  },
});
