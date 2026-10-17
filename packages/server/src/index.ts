import { GAME_NAME, GAME_VERSION } from '@yilan/shared';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const startedAt = Date.now();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': MIME['.json']!, 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Derlenmiş istemciyi (client/dist) sunar; dist dışına çıkan yolları reddeder. */
async function serveStatic(urlPath: string, res: http.ServerResponse): Promise<void> {
  const rel = decodeURIComponent(urlPath.split('?')[0]!);
  let file = path.resolve(CLIENT_DIST, '.' + (rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(CLIENT_DIST + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = path.join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      rel === '/'
        ? 'İstemci derlenmemiş. Önce "npm run build" çalıştırın veya geliştirme için "npm run dev".'
        : 'Bulunamadı',
    );
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': rel.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/health') {
    sendJson(res, 200, {
      ok: true,
      name: GAME_NAME,
      version: GAME_VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      rooms: 0,
      players: 0,
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(url, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

server.listen(PORT, HOST, () => {
  console.log(`${GAME_NAME} sunucusu v${GAME_VERSION} → http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Aynı ağdaki cihazlardan: http://${ip}:${PORT}`);
});
