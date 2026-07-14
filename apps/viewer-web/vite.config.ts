import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 2048,
    rolldownOptions: {
      input: {
        main: "index.html",
        keyxymMobile: "keyxym-mobile.html",
        personalWeave: "personal-weave.html",
      },
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
  server: { strictPort: true },
});
