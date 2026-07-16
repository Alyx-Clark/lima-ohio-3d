import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1_100,
  },
});
