'use strict';

const fs = require('node:fs');
const pathModule = require('node:path');
const zlib = require('node:zlib');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function decodePng(input) {
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const data = [];
  while (offset < input.length) {
    const length = input.readUInt32BE(offset), type = input.toString('ascii', offset + 4, offset + 8);
    const part = input.subarray(offset + 8, offset + 8 + length); offset += 12 + length;
    if (type === 'IHDR') { width = part.readUInt32BE(0); height = part.readUInt32BE(4); bitDepth = part[8]; colorType = part[9]; }
    if (type === 'IDAT') data.push(part);
    if (type === 'IEND') break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error('Unsupported Schoology logo PNG format.');
  const channels = colorType === 6 ? 4 : 3, stride = width * channels;
  const packed = zlib.inflateSync(Buffer.concat(data)), pixels = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = packed[pos++];
    for (let x = 0; x < stride; x++) {
      const raw = packed[pos++], left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}
function renderSplash(logo, requestedWidth = 1170, requestedHeight = 2532) {
  const width = Math.max(320, Math.min(2732, Math.round(requestedWidth || 1170)));
  const height = Math.max(320, Math.min(2732, Math.round(requestedHeight || 2532)));
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { out[i * 4] = 34; out[i * 4 + 1] = 48; out[i * 4 + 2] = 62; out[i * 4 + 3] = 255; }
  const targetWidth = 842, targetHeight = Math.round(logo.height * targetWidth / logo.width);
  const left = Math.floor((width - targetWidth) / 2), top = Math.floor((height - targetHeight) / 2);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
    const sx = Math.min(logo.width - 1, Math.floor(x * logo.width / targetWidth));
    const sy = Math.min(logo.height - 1, Math.floor(y * logo.height / targetHeight));
    const si = (sy * logo.width + sx) * logo.channels, di = ((top + y) * width + left + x) * 4;
    const alpha = logo.channels === 4 ? logo.pixels[si + 3] / 255 : 1;
    for (let c = 0; c < 3; c++) out[di + c] = Math.round(logo.pixels[si + c] * alpha + out[di + c] * (1 - alpha));
  }
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) out.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); res.statusCode = 405; return res.end(); }
  try {
    const logoPath = pathModule.join(process.cwd(), 'assets', 'logo_schoology.png');
    const requestedWidth = Number(req.query?.width || new URL(req.url, 'https://localhost').searchParams.get('width')) || 1170;
    const requestedHeight = Number(req.query?.height || new URL(req.url, 'https://localhost').searchParams.get('height')) || 2532;
    const png = renderSplash(decodePng(fs.readFileSync(logoPath)), requestedWidth, requestedHeight);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(png.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return req.method === 'HEAD' ? res.end() : res.end(png);
  } catch (_) {
    res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.end('Unable to generate Schoology splash image.');
  }
};
