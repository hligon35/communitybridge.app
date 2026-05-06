#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

function parseNodeMajor(version) {
  const match = String(version || '').match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

function getNodeMajorAtPath(nodeExe) {
  try {
    const r = spawnSync(nodeExe, ['-p', 'process.versions.node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (r.status !== 0) return 0;
    return parseNodeMajor(String(r.stdout || '').trim());
  } catch (_) {
    return 0;
  }
}

function reexecWithNvmNode20IfNeeded() {
  if (process.platform !== 'win32') return false;
  if (process.env.BB_NODE_REEXEC === '1') return false;

  const major = parseNodeMajor(process.versions && process.versions.node);
  // Expo CLI has known runtime issues on very new Node majors (e.g. Node 24).
  // Prefer Node 20 in this repo.
  if (major > 0 && major < 23) return false;

  const candidates = [];

  // nvm4w typically exposes the active version at NVM_SYMLINK\node.exe
  if (process.env.NVM_SYMLINK) {
    candidates.push(path.join(process.env.NVM_SYMLINK, 'node.exe'));
  }

  // Common nvm4w default symlink location
  candidates.push('C:\\nvm4w\\nodejs\\node.exe');

  // If a versioned install is present, include it as a fallback.
  if (process.env.NVM_HOME) {
    candidates.push(path.join(process.env.NVM_HOME, 'v20.20.0', 'node.exe'));
    candidates.push(path.join(process.env.NVM_HOME, '20.20.0', 'node.exe'));
  }
  candidates.push('C:\\nvm4w\\v20.20.0\\node.exe');
  candidates.push('C:\\nvm\\v20.20.0\\node.exe');

  const node20Exe = candidates.find((p) => {
    try {
      if (!p || !fs.existsSync(p)) return false;
      const majorAtPath = getNodeMajorAtPath(p);
      return majorAtPath === 20;
    } catch (_) {
      return false;
    }
  });

  if (!node20Exe) {
    console.error(
      `\nUnsupported Node.js v${process.versions.node} for Expo web dev in this repo.\n` +
        `Install/use Node 20.20.0 (nvm4w) and re-run: npm run web\n`
    );
    process.exit(1);
  }

  const child = spawn(node20Exe, [process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, BB_NODE_REEXEC: '1' },
  });

  child.on('exit', (code) => {
    process.exit(typeof code === 'number' ? code : 1);
  });

  return true;
}

function canListenOn(port, host) {
  return new Promise((resolve) => {
    const server = net
      .createServer()
      .once('error', (err) => {
        // Port is taken or we don't have permission.
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          resolve(false);
          return;
        }

        // IPv6 might not be available on some systems.
        if (err && err.code === 'EADDRNOTAVAIL') {
          resolve(true);
          return;
        }

        resolve(false);
      })
      .once('listening', () => {
        server.close(() => resolve(true));
      });

    if (host) server.listen(port, host);
    else server.listen(port);
  });
}

async function isPortAvailable(port) {
  // Expo binds broadly, so ensure the port is free on wildcard listeners.
  const v4Ok = await canListenOn(port, '0.0.0.0');
  if (!v4Ok) return false;
  const v6Ok = await canListenOn(port, '::');
  return v6Ok;
}

async function findAvailablePort(startPort, maxTries = 25) {
  for (let i = 0; i < maxTries; i += 1) {
    const port = startPort + i;
    // eslint-disable-next-line no-await-in-loop
    const ok = await isPortAvailable(port);
    if (ok) return port;
  }
  return startPort;
}

function removeDirIfExists(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function readFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

function writeFileSafe(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function getMarketingIndexHtml(publicRoot) {
  const devMarker = '<!-- expo-dev-index -->';
  const indexHtml = readFileIfExists(path.join(publicRoot, 'index.html')) || '';
  const backupHtml = readFileIfExists(path.join(publicRoot, '.index.marketing.backup.html')) || '';

  if (indexHtml && !indexHtml.includes(devMarker)) return indexHtml;
  if (backupHtml) return backupHtml;
  return indexHtml || '<!doctype html><html><body></body></html>';
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.xml') return 'application/xml; charset=utf-8';
  return 'application/octet-stream';
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (_) {
    return pathname;
  }
}

function resolvePublicStaticFile(publicRoot, requestPath) {
  const publicRootPrefix = `${path.resolve(publicRoot)}${path.sep}`;
  const pathname = safeDecodePathname(String(requestPath || '/').split('?')[0].split('#')[0]);
  if (pathname === '/' || pathname === '/index.html') return null;

  const cleanPath = pathname.replace(/^\/+/, '');
  if (!cleanPath) return null;

  const directCandidate = path.resolve(publicRoot, cleanPath);
  if ((directCandidate === path.resolve(publicRoot) || directCandidate.startsWith(publicRootPrefix)) && fs.existsSync(directCandidate)) {
    const stat = fs.statSync(directCandidate);
    if (stat.isFile()) return directCandidate;
  }

  if (!path.extname(cleanPath)) {
    const indexCandidate = path.resolve(publicRoot, cleanPath, 'index.html');
    if ((indexCandidate === path.resolve(publicRoot) || indexCandidate.startsWith(publicRootPrefix)) && fs.existsSync(indexCandidate)) {
      const stat = fs.statSync(indexCandidate);
      if (stat.isFile()) return indexCandidate;
    }
  }

  return null;
}

function shouldProxyToExpo(pathname) {
  return pathname === '/login'
    || pathname === '/login.html'
    || pathname.startsWith('/login/')
    || pathname === '/app-login'
    || pathname === '/app-login.html'
    || pathname.startsWith('/app-login/')
    || pathname === '/dashboard'
    || pathname === '/dashboard.html'
    || pathname.startsWith('/dashboard/')
    || pathname === '/home'
    || pathname === '/home.html'
    || pathname.startsWith('/home/')
    || pathname.startsWith('/node_modules/')
    || pathname.startsWith('/_expo/')
    || pathname.startsWith('/assets/');
}

function serveString(res, statusCode, content, contentType) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  res.end(content);
}

function serveFile(res, filePath) {
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Cache-Control': path.extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(body);
  } catch (error) {
    serveString(res, 500, 'Could not read requested file.', 'text/plain; charset=utf-8');
  }
}

function proxyToExpo(req, res, expoPort) {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: expoPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${expoPort}`,
    },
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    serveString(
      res,
      502,
      'Expo web dev server is not reachable yet. Wait for the bundle to finish loading and try again.',
      'text/plain; charset=utf-8'
    );
  });

  req.pipe(upstream);
}

async function startMarketingBridgeServer({ publicRoot, marketingIndexHtml, expoPort, preferredPort }) {
  const bridgePort = await findAvailablePort(preferredPort, 20);
  const server = http.createServer((req, res) => {
    const pathname = safeDecodePathname(String(req.url || '/').split('?')[0].split('#')[0]);

    if (shouldProxyToExpo(pathname)) {
      proxyToExpo(req, res, expoPort);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveString(res, 200, marketingIndexHtml, 'text/html; charset=utf-8');
      return;
    }

    const staticFile = resolvePublicStaticFile(publicRoot, pathname);
    if (staticFile) {
      serveFile(res, staticFile);
      return;
    }

    serveString(res, 404, 'Not found.', 'text/plain; charset=utf-8');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(bridgePort, '127.0.0.1', () => resolve());
  });

  return { server, bridgePort };
}

function ensureExpoDevIndex(publicRoot) {
  const devMarker = '<!-- expo-dev-index -->';
  const indexPath = path.join(publicRoot, 'index.html');
  const backupPath = path.join(publicRoot, '.index.marketing.backup.html');

  // Self-heal from a previous crash: if a backup exists and the current index
  // is the dev index, restore the marketing index.
  const currentIndex = readFileIfExists(indexPath);
  const backupIndex = readFileIfExists(backupPath);
  if (backupIndex && currentIndex && currentIndex.includes(devMarker)) {
    writeFileSafe(indexPath, backupIndex);
    try {
      fs.unlinkSync(backupPath);
    } catch (_) {
      // ignore
    }
  }

  // If the current index is already a real marketing page, any leftover backup
  // is stale and should not be allowed to overwrite newer edits on cleanup.
  if (backupIndex && currentIndex && !currentIndex.includes(devMarker)) {
    try {
      fs.unlinkSync(backupPath);
    } catch (_) {
      // ignore
    }
  }

  const refreshedIndex = readFileIfExists(indexPath) || '';
  if (/id=["']root["']/.test(refreshedIndex)) {
    return { cleanup: () => {} };
  }

  // Backup the marketing index so Expo can use a minimal HTML shell in dev.
  if (refreshedIndex.length > 0 && !fs.existsSync(backupPath)) {
    writeFileSafe(backupPath, refreshedIndex);
  }

  const webIndexPath = path.join(__dirname, '..', 'web', 'index.html');
  const webIndex = readFileIfExists(webIndexPath);
  const devIndex = (webIndex && /id=["']root["']/.test(webIndex)
    ? webIndex
    : `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>CommunityBridge</title>\n  </head>\n  <body>\n    <noscript>You need to enable JavaScript to run this app.</noscript>\n    <div id="root"></div>\n  </body>\n</html>\n`);

  writeFileSafe(indexPath, `${devMarker}\n${devIndex}`);

  const cleanup = () => {
    const backup = readFileIfExists(backupPath);
    if (!backup) return;
    const latestIndex = readFileIfExists(indexPath) || '';
    try {
      if (latestIndex.includes(devMarker)) {
        writeFileSafe(indexPath, backup);
      }
      fs.unlinkSync(backupPath);
    } catch (_) {
      // ignore
    }
  };

  return { cleanup };
}

async function main() {
  if (reexecWithNvmNode20IfNeeded()) return;

  console.log(`Using Node.js v${process.versions.node} (${process.execPath})`);

  // Expo dev server mounts /_expo and /assets itself.
  // If we leave exported build artifacts under public/, they can conflict with
  // dev routing and cause "Asset not found" errors for hashed export assets.
  const publicRoot = path.join(__dirname, '..', 'public');
  const marketingIndex = getMarketingIndexHtml(publicRoot);
  const expoPort = await findAvailablePort(8081);

  // Expo's web dev server uses public/index.html as its HTML shell.
  // This repo uses public/index.html for the marketing site, which doesn't
  // include a #root mount point. Temporarily swap in a minimal dev index.
  const { cleanup: cleanupIndex } = ensureExpoDevIndex(publicRoot);

  removeDirIfExists(path.join(publicRoot, '_expo'));
  removeDirIfExists(path.join(publicRoot, 'assets'));
  removeDirIfExists(path.join(publicRoot, 'dashboard'));
  removeDirIfExists(path.join(publicRoot, 'home'));

  const { server: bridgeServer, bridgePort } = await startMarketingBridgeServer({
    publicRoot,
    marketingIndexHtml: marketingIndex,
    expoPort,
    preferredPort: 8080,
  });

  const isWindows = process.platform === 'win32';

  let cleanedUp = false;
  const cleanupOnce = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      bridgeServer.close();
    } catch (_) {
      // ignore
    }
    cleanupIndex();
  };

  process.on('exit', cleanupOnce);
  process.on('SIGINT', () => {
    cleanupOnce();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupOnce();
    process.exit(143);
  });

  console.log(`Marketing dev bridge: http://127.0.0.1:${bridgePort}`);
  console.log(`Expo web dev server: http://127.0.0.1:${expoPort}`);

  const expoCommand = `npx expo start --web --port ${expoPort} --offline`;

  const expoEnv = { ...process.env, EXPO_OFFLINE: '1' };

  const child = isWindows
    ? spawn('cmd.exe', ['/d', '/s', '/c', expoCommand], {
        stdio: 'inherit',
        env: expoEnv,
      })
    : spawn('npx', ['expo', 'start', '--web', '--port', String(port), '--offline'], {
        stdio: 'inherit',
        env: expoEnv,
      });

  child.on('exit', (code) => {
    cleanupOnce();
    process.exit(typeof code === 'number' ? code : 1);
  });
}

main();
