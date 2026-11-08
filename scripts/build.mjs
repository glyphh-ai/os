// Build the renderer into dist/: one ES module bundle plus static assets.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/renderer/app.js")],
  bundle: true, format: "esm", platform: "browser", target: "chrome130",
  outfile: path.join(dist, "app.js"), sourcemap: true, logLevel: "info",
});

const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
cp("src/renderer/index.html", "index.html");
cp("src/renderer/styles.css", "styles.css");
cp("node_modules/@xterm/xterm/css/xterm.css", "xterm.css");
cp("node_modules/monaco-editor/min/vs", "monaco/vs");
cp("assets/fonts", "fonts");
cp("assets/brand", "brand");
console.log("built dist/");
