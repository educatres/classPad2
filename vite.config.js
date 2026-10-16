import { defineConfig } from "vite";
import { createRequire } from "node:module";
import { dirname, join, basename } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

function pdfAssets() {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const folders = ["cmaps", "standard_fonts", "wasm", "iccs"];
  let building = false;
  return {
    name: "local-pdf-assets",
    configResolved(config) { building = config.command === "build"; },
    buildStart() {
      if (!building) return;
      for (const folder of folders) for (const file of readdirSync(join(root, folder))) {
        this.emitFile({ type: "asset", fileName: `pdf-assets/${folder}/${file}`, source: readFileSync(join(root, folder, file)) });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.split("?")[0].match(/\/pdf-assets\/(cmaps|standard_fonts|wasm|iccs)\/([^/]+)$/);
        if (!match || basename(match[2]) !== match[2]) return next();
        try { res.setHeader("Content-Type", match[2].endsWith(".wasm") ? "application/wasm" : "application/octet-stream"); res.end(readFileSync(join(root, match[1], match[2]))); } catch { next(); }
      });
    }
  };
}

export default defineConfig({
  plugins: [pdfAssets()],
  base: process.env.GITHUB_ACTIONS ? "/classPad2/" : "/",
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        home: "index.html",
        teacher: "teacher.html",
        monitor: "monitor.html",
        lecture: "lecture.html",
        display: "display.html",
        student: "student.html",
        privacy: "privacy.html"
      }
    }
  }
});
