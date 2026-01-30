const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const FIGURE_DIR = path.join(ROOT_DIR, "figure");

const products = [
  {
    id: "dreamy-lavender",
    name: "Dreamy Lavender",
    lead: "Soft lavender petals layered with bergamot and a whisper of clean musk.",
    detail:
      "An elegant composition that feels like fresh linen in a quiet suite—calming, airy, and endlessly refined.",
    notes: "Top: Bergamot, Neroli · Heart: Lavender, Iris · Base: Clean Musk, Cashmere Woods",
    image: "../figure/vmate_1.png",
    mood: "Serene Calm",
  },
  {
    id: "white-tea-muse",
    name: "White Tea Muse",
    lead: "Airy white tea, pear blossom, and sheer woods for a fresh, luminous aura.",
    detail:
      "A contemporary, luminous scent that brightens the cabin with clarity—crisp, polished, and quietly confident.",
    notes: "Top: White Tea, Pear · Heart: Lily, Magnolia · Base: Blonde Woods, Soft Amber",
    image: "../figure/vmate_2.png",
    mood: "Bright Clarity",
  },
  {
    id: "osmanthus-moon",
    name: "Osmanthus Moon",
    lead: "Golden osmanthus, honeyed apricot, and warm amber for a moonlit calm.",
    detail:
      "A velvety warmth with golden depth—designed for evening drives and a lingering sense of comfort.",
    notes: "Top: Osmanthus, Apricot · Heart: Amber, Honey · Base: Sandalwood, Soft Resin",
    image: "../figure/vmate_3.png",
    mood: "Golden Warmth",
  },
];

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, payload) {
  const data = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function safeResolve(baseDir, requestedPath) {
  const resolvedPath = path.resolve(baseDir, requestedPath);
  if (!resolvedPath.startsWith(baseDir)) {
    return null;
  }
  return resolvedPath;
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendNotFound(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/products") {
    sendJson(res, products);
    return;
  }

  if (url.pathname === "/api/brand") {
    sendJson(res, {
      name: "Vmate",
      tagline: "Refined fragrance for the moments between destinations.",
      market: "United States",
    });
    return;
  }

  if (url.pathname.startsWith("/figure/")) {
    const filePath = safeResolve(FIGURE_DIR, `.${url.pathname.slice(7)}`);
    if (!filePath) {
      sendNotFound(res);
      return;
    }
    serveStatic(res, filePath);
    return;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeResolve(FRONTEND_DIR, `.${requestedPath}`);
  if (!filePath) {
    sendNotFound(res);
    return;
  }

  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Vmate site running on http://localhost:${PORT}`);
});
