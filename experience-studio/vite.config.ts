import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function forceInterCss(source: string) {
  return source.replace(
    /font-family:-apple-system,system-ui,BlinkMacSystemFont,Segoe UI,Segoe UI Symbol,Segoe UI Emoji,Apple Color Emoji,Roboto,Helvetica,Arial,sans-serif/g,
    "font-family:Inter",
  );
}

function forceInterFontFamily(): Plugin {
  return {
    name: "force-inter-font-family",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) {
          continue;
        }

        const source = typeof asset.source === "string"
          ? asset.source
          : new TextDecoder().decode(asset.source);

        asset.source = forceInterCss(source);
      }
    },
    writeBundle(options, bundle) {
      if (!options.dir) return;

      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) {
          continue;
        }

        const filePath = join(options.dir, asset.fileName);
        writeFileSync(filePath, forceInterCss(readFileSync(filePath, "utf8")));
      }
    },
  };
}

export default defineConfig({
  base: "/admin/experience-studio/",
  plugins: [react(), forceInterFontFamily()],
  build: {
    outDir: resolve(__dirname, "../Deno/admin/experience-studio"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "src/studio/main.tsx"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return "assets/[name][extname]";
        },
      },
    },
  },
});
