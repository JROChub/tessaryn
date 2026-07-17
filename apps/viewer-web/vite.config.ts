import { defineConfig } from "vite";

const TOP_ACTIONS_MARKER = '        <div class="top-actions">\n';
const PRODUCTION_NAVIGATION = `          <a
             id="world-cell-command"
             class="icon-command secondary"
             href="./world-cell-theater/"
             title="Open live World Cell capture"
           >
             <i data-lucide="scan"></i><span>WORLD CELL</span>
           </a>
           <a
             id="release-attestation-command"
             class="icon-button"
             href="./release.json"
             type="application/json"
             title="Inspect the deployed release attestation"
             aria-label="Inspect deployed release attestation"
           ><i data-lucide="shield-check"></i></a>
`;

export function injectProductionNavigation(html: string): string {
  if (!html.includes(TOP_ACTIONS_MARKER)) return html;
  if (html.includes('id="world-cell-command"')) {
    throw new Error("TESSARYN production navigation was injected more than once");
  }
  return html.replace(TOP_ACTIONS_MARKER, TOP_ACTIONS_MARKER + PRODUCTION_NAVIGATION);
}

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "tessaryn-production-navigation",
      enforce: "pre",
      transformIndexHtml: injectProductionNavigation,
    },
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    assetsInlineLimit: 2048,
    rolldownOptions: {
      input: {
        main: "index.html",
        keyxymMobile: "keyxym-mobile.html",
        personalWeave: "personal-weave.html",
        worldCellTheater: "world-cell-theater.html",
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
