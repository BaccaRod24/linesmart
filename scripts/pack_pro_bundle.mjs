// Pack the private Pro bundle. GitHub Pages never deploys this file.
// Usage: node scripts/pack_pro_bundle.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "pro/pro.css"), "utf8");
const parts = [
  fs.readFileSync(path.join(root, "pro/hot-props-core.js"), "utf8"),
  fs.readFileSync(path.join(root, "pro/pro-features.js"), "utf8"),
  "window.__PRO_CSS = " + JSON.stringify(css) + ";\n",
  fs.readFileSync(path.join(root, "pro/pro-ui.js"), "utf8"),
];
const outDir = path.join(root, "pro/dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "pro-app.js");
fs.writeFileSync(out, parts.join("\n"));
if (!fs.readFileSync(out, "utf8").includes("window.LSProApp")) throw new Error("bundle missing LSProApp");
console.log("wrote", out, fs.statSync(out).size, "bytes");
