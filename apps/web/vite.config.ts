import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path";
import { webRelease } from "./releaseConfig.js";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const release = webRelease({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
  return {
    plugins: [react(), tailwindcss(), {
      name: 'release-identity',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'release.json', source: JSON.stringify(release) });
      }
    }],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src")
      }
    }
  };
})
