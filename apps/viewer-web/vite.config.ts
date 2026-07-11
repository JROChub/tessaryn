import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 2048,
    rolldownOptions: {
      output: {
        codeSplitting: {
          maxSize: 420_000,
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
            { name: "icons", test: /node_modules[\\/]lucide[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    strictPort: true,
  },
});
