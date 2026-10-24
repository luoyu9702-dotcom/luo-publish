import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

await esbuild.build({
  entryPoints: {
    background: "src/background.ts",
    popup: "src/popup.ts",
  },
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "es2022",
  platform: "browser",
  charset: "utf8",
  legalComments: "none",
  logLevel: "info",
});

mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("src/popup.html", "dist/popup.html");
