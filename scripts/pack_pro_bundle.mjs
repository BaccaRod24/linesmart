// Pack the private Pro bundle. GitHub Pages never deploys this file.
// Usage: node scripts/pack_pro_bundle.mjs
import crypto from "crypto";
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
const body = parts.join("\n");
const hash = crypto.createHash("sha256").update(body).digest("hex").slice(0, 10);
const when = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const id = hash + "-" + when;
const outDir = path.join(root, "pro/dist");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "pro-app.js");
fs.writeFileSync(out, "window.__PRO_BUILD=" + JSON.stringify(id) + ";\n" + body);
const packed = fs.readFileSync(out, "utf8");
if (!packed.includes("window.LSProApp")) throw new Error("bundle missing LSProApp");
if (!packed.includes("window.__PRO_BUILD=" + JSON.stringify(id))) throw new Error("bundle missing build id");
console.log("wrote", out, fs.statSync(out).size, "bytes", id);
