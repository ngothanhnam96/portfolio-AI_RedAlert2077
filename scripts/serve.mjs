// Zero-dependency static server for local play: `npm start` → http://127.0.0.1:5173
// (ES modules do not load from file://, so the game needs to be served over http.)

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
};

http
  .createServer(async (request, response) => {
    let relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (relative.endsWith("/")) relative += "index.html";
    const file = path.join(root, path.normalize(relative));
    const hidden = relative.split("/").some((part) => part.startsWith("."));
    if (!file.startsWith(root + path.sep) || hidden) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Chiến Binh Volt → http://127.0.0.1:${port}`);
  });
