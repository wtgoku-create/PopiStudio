#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(projectRoot, 'resources/tray');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function writePng(filePath, width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function drawLine(canvas, width, height, x0, y0, x1, y1, radius, color) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + radius + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + radius + 1));
  const vx = x1 - x0;
  const vy = y1 - y0;
  const lenSq = vx * vx + vy * vy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = lenSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / lenSq));
      const dx = px - (x0 + t * vx);
      const dy = py - (y0 + t * vy);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius + 1) continue;

      const coverage = Math.max(0, Math.min(1, radius + 0.75 - distance));
      const offset = (y * width + x) * 4;
      const srcA = coverage * (color[3] / 255);
      const dstA = canvas[offset + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) continue;

      canvas[offset] = Math.round((color[0] * srcA + canvas[offset] * dstA * (1 - srcA)) / outA);
      canvas[offset + 1] = Math.round((color[1] * srcA + canvas[offset + 1] * dstA * (1 - srcA)) / outA);
      canvas[offset + 2] = Math.round((color[2] * srcA + canvas[offset + 2] * dstA * (1 - srcA)) / outA);
      canvas[offset + 3] = Math.round(outA * 255);
    }
  }
}

function renderInfinityTemplate(size) {
  const scale = 4;
  const width = size * scale;
  const height = size * scale;
  const canvas = Buffer.alloc(width * height * 4);
  const color = [0, 0, 0, 255];
  const centerX = width / 2;
  const centerY = height / 2;
  const ampX = width * 0.41;
  const ampY = height * 0.23;
  const radius = Math.max(1.95, size * 0.095) * scale;
  const samples = 220;
  let prevX = centerX + ampX * Math.sin(0);
  let prevY = centerY + ampY * Math.sin(0);

  for (let i = 1; i <= samples; i += 1) {
    const t = (Math.PI * 2 * i) / samples;
    const x = centerX + ampX * Math.sin(t);
    const y = centerY + ampY * Math.sin(2 * t);
    drawLine(canvas, width, height, prevX, prevY, x, y, radius, color);
    prevX = x;
    prevY = y;
  }

  const downsampled = Buffer.alloc(size * size * 4);
  const count = scale * scale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = 0; yy < scale; yy += 1) {
        for (let xx = 0; xx < scale; xx += 1) {
          const src = (((y * scale + yy) * width) + (x * scale + xx)) * 4;
          r += canvas[src];
          g += canvas[src + 1];
          b += canvas[src + 2];
          a += canvas[src + 3];
        }
      }
      const dst = (y * size + x) * 4;
      downsampled[dst] = Math.round(r / count);
      downsampled[dst + 1] = Math.round(g / count);
      downsampled[dst + 2] = Math.round(b / count);
      downsampled[dst + 3] = Math.round(a / count);
    }
  }
  return downsampled;
}

function makeIco(entries, outputPath) {
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + entrySize * entries.length;
  const frames = entries.map(({ size, data }) => {
    const frame = {
      width: size >= 256 ? 0 : size,
      height: size >= 256 ? 0 : size,
      dataSize: data.length,
      offset,
      data,
    };
    offset += data.length;
    return frame;
  });
  const ico = Buffer.alloc(offset);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(frames.length, 4);
  frames.forEach((frame, index) => {
    const base = headerSize + index * entrySize;
    ico.writeUInt8(frame.width, base);
    ico.writeUInt8(frame.height, base + 1);
    ico.writeUInt8(0, base + 2);
    ico.writeUInt8(0, base + 3);
    ico.writeUInt16LE(1, base + 4);
    ico.writeUInt16LE(32, base + 6);
    ico.writeUInt32LE(frame.dataSize, base + 8);
    ico.writeUInt32LE(frame.offset, base + 12);
    frame.data.copy(ico, frame.offset);
  });
  fs.writeFileSync(outputPath, ico);
}

function generateTemplateIcon(size, fileName) {
  const rgba = renderInfinityTemplate(size);
  const outputPath = path.join(outputDir, fileName);
  writePng(outputPath, size, size, rgba);
  return fs.readFileSync(outputPath);
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const mac1x = generateTemplateIcon(18, 'tray-icon-mac.png');
  const mac2x = generateTemplateIcon(36, 'tray-icon-mac@2x.png');
  fs.copyFileSync(path.join(outputDir, 'tray-icon-mac.png'), path.join(outputDir, 'trayIconTemplate.png'));
  fs.copyFileSync(path.join(outputDir, 'tray-icon-mac@2x.png'), path.join(outputDir, 'trayIconTemplate@2x.png'));

  const generic = generateTemplateIcon(48, 'tray-icon.png');
  const ico16Path = path.join(outputDir, '.tray-template-16.png');
  const ico32Path = path.join(outputDir, '.tray-template-32.png');
  const ico16Rgba = renderInfinityTemplate(16);
  const ico32Rgba = renderInfinityTemplate(32);
  writePng(ico16Path, 16, 16, ico16Rgba);
  writePng(ico32Path, 32, 32, ico32Rgba);
  makeIco([
    { size: 48, data: generic },
    { size: 32, data: fs.readFileSync(ico32Path) },
    { size: 16, data: fs.readFileSync(ico16Path) },
  ], path.join(outputDir, 'tray-icon.ico'));
  fs.rmSync(ico16Path, { force: true });
  fs.rmSync(ico32Path, { force: true });

  console.log(`Generated macOS template tray icons: ${mac1x.length} bytes, ${mac2x.length} bytes`);
}

main();
