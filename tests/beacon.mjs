import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mp4": "video/mp4", ".png": "image/png" };

http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/report") {
    console.log("REPORT", decodeURIComponent(u.searchParams.get("d") || ""));
    res.writeHead(204).end();
    return;
  }
  const p = join(ROOT, u.pathname);
  if (!existsSync(p) || !statSync(p).isFile()) { res.writeHead(404).end(); return; }

  const size = statSync(p).size;
  const type = TYPES[extname(p)] || "application/octet-stream";
  const range = req.headers.range;

  // Safari 播放媒体必须支持 Range
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
    });
    res.end(readFileSync(p).subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
  res.end(readFileSync(p));
}).listen(8900, "127.0.0.1", () => console.log("beacon on 8900"));
