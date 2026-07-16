import { defineConfig } from "vite";

export default defineConfig({
  base: "/lima-3d/",
  build: {
    target: "es2022",
    sourcemap: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1_100,
  },
});
