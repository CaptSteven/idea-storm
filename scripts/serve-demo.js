import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(new URL("../", import.meta.url).pathname);
const port = Number(process.env.DEMO_PORT || process.env.PORT || 4173);
const host = process.env.DEMO_HOST || "127.0.0.1";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export function createDemoServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || host}`);
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const path = resolve(root, `.${requested}`);
      if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
      if (!(await stat(path)).isFile()) throw new Error("Not a file");
      const body = await readFile(path);
      res.writeHead(200, {
        "Content-Type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const server = createDemoServer();
  server.listen(port, host, () => console.log(`SOPFlow demo available at http://${host}:${port}`));
}
