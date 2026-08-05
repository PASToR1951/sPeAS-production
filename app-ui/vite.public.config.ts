import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/react-ui/",
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    outDir: resolve(__dirname, "../Deno/Public/react-ui"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        "main-public": resolve(__dirname, "src/main-public.tsx"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "style.css";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
