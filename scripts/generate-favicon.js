const fs = require('fs');
const os = require('os');
const path = require('path');

function isFileLockError(error) {
  const code = String(error?.code || '').toUpperCase();
  return code === 'EPERM' || code === 'EBUSY' || code === 'UNKNOWN';
}

async function ensureSquarePng({ srcPng, destPng }) {
  const { Jimp } = require('jimp');

  const img = await Jimp.read(srcPng);
  const width = img.bitmap.width;
  const height = img.bitmap.height;
  const size = Math.max(width, height);

  if (width === height) {
    fs.mkdirSync(path.dirname(destPng), { recursive: true });
    fs.copyFileSync(srcPng, destPng);
    return;
  }

  const canvas = new Jimp({ width: size, height: size, color: 0x00000000 });
  const x = Math.floor((size - width) / 2);
  const y = Math.floor((size - height) / 2);
  canvas.composite(img, x, y);

  fs.mkdirSync(path.dirname(destPng), { recursive: true });
  await canvas.write(destPng);
}

async function generateFaviconIco({ srcPng, destIcoPaths }) {
  const pngToIcoModule = await import('png-to-ico');
  const pngToIco = pngToIcoModule.default;

  if (!fs.existsSync(srcPng)) {
    throw new Error(`Source PNG not found: ${srcPng}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddyboard-favicon-'));
  const squarePng = path.join(tmpDir, 'icon-square.png');

  try {
    await ensureSquarePng({ srcPng, destPng: squarePng });
    const icoBuffer = await pngToIco(squarePng);

    let wroteAtLeastOne = false;
    for (const destIco of destIcoPaths) {
      fs.mkdirSync(path.dirname(destIco), { recursive: true });
      try {
        fs.writeFileSync(destIco, icoBuffer);
        wroteAtLeastOne = true;
      } catch (error) {
        if (!isFileLockError(error)) throw error;
        console.warn(`Skipping locked favicon target: ${destIco}`);
      }
    }

    if (!wroteAtLeastOne) {
      throw new Error('Could not write favicon.ico to any target path.');
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const srcPng = path.join(repoRoot, 'public', 'icon.png');

  const destIcoPaths = [
    path.join(repoRoot, 'public', 'favicon.ico'),
    path.join(repoRoot, 'web-dist', 'favicon.ico'),
  ];

  await generateFaviconIco({ srcPng, destIcoPaths });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
