import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = path.resolve(process.cwd(), 'assets');
fs.mkdirSync(OUT_DIR, { recursive: true });

// --- minimal PNG encoder (RGBA, 8-bit) ---
function crc32(buf) {
  // table-based CRC32
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & (-(c & 1)));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.from(data);
  const len = u32be(d.length);
  const crc = u32be(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crc]);
}

function encodePngRGBA({ width, height, data }) {
  // data is Uint8Array length width*height*4
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[(stride + 1) * y] = 0;
    data.copy(raw, (stride + 1) * y + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- tiny raster helpers ---
function makeCanvas(w, h) {
  return { width: w, height: h, data: Buffer.alloc(w * h * 4, 0) };
}

function setPixel(img, x, y, rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i + 0] = rgba[0];
  img.data[i + 1] = rgba[1];
  img.data[i + 2] = rgba[2];
  img.data[i + 3] = rgba[3];
}

function blendOver(dst, src) {
  // src over dst, both 0..255
  const sa = src[3] / 255;
  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return [0, 0, 0, 0];
  const r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa;
  const g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa;
  const b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa;
  return [r | 0, g | 0, b | 0, (oa * 255) | 0];
}

function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function fillRect(img, x, y, w, h, rgba) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const dst = getPixel(img, xx, yy);
      const out = blendOver(dst, rgba);
      setPixel(img, xx, yy, out);
    }
  }
}

function fillCircle(img, cx, cy, r, rgba) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const dst = getPixel(img, x, y);
        const out = blendOver(dst, rgba);
        setPixel(img, x, y, out);
      }
    }
  }
}

function fillRoundRect(img, x, y, w, h, r, rgba) {
  // center rect
  fillRect(img, x + r, y, w - 2 * r, h, rgba);
  fillRect(img, x, y + r, w, h - 2 * r, rgba);
  // corners
  fillCircle(img, x + r, y + r, r, rgba);
  fillCircle(img, x + w - 1 - r, y + r, r, rgba);
  fillCircle(img, x + r, y + h - 1 - r, r, rgba);
  fillCircle(img, x + w - 1 - r, y + h - 1 - r, r, rgba);
}

function strokeRoundRect(img, x, y, w, h, r, thickness, rgba) {
  // cheap stroke: draw 4 thin rects + 4 ring corners
  for (let t = 0; t < thickness; t++) {
    fillRoundRect(img, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0, r - t), rgba);
  }
}

// --- sprite design (cartoon-flat, 32x32) ---
const C = {
  base: [68, 209, 108, 255],      // #44d16c
  light: [119, 242, 160, 255],    // #77f2a0
  dark: [28, 140, 74, 255],       // darker green
  outline: [10, 20, 15, 170],     // soft outline
  eyeWhite: [245, 247, 250, 255],
  eye: [20, 30, 40, 255],
  tongue: [255, 77, 109, 255],
  alpha0: [0, 0, 0, 0],
};

function makeBody() {
  const img = makeCanvas(32, 32);
  // main blob
  fillRoundRect(img, 4, 6, 24, 20, 9, C.base);
  // subtle highlight stripe
  fillRoundRect(img, 7, 8, 18, 6, 6, [C.light[0], C.light[1], C.light[2], 170]);
  // scale dots
  for (let y = 12; y <= 22; y += 4) {
    for (let x = 10; x <= 22; x += 4) {
      fillCircle(img, x, y, 1, [255, 255, 255, 28]);
    }
  }
  // outline-ish shadow at bottom
  fillRoundRect(img, 6, 20, 20, 5, 4, [C.dark[0], C.dark[1], C.dark[2], 120]);
  // soft outline (very light)
  strokeRoundRect(img, 4, 6, 24, 20, 9, 1, C.outline);
  return img;
}

function makeHead() {
  const img = makeCanvas(32, 32);
  // head slightly bigger
  fillRoundRect(img, 3, 5, 26, 22, 10, C.light);
  fillRoundRect(img, 5, 7, 22, 18, 9, [C.base[0], C.base[1], C.base[2], 220]);
  // eyes
  fillCircle(img, 12, 14, 3, C.eyeWhite);
  fillCircle(img, 20, 14, 3, C.eyeWhite);
  fillCircle(img, 13, 15, 1, C.eye);
  fillCircle(img, 21, 15, 1, C.eye);
  // tiny mouth + tongue (pointing right by default)
  fillRoundRect(img, 22, 18, 6, 2, 1, [0, 0, 0, 80]);
  fillRoundRect(img, 27, 18, 3, 2, 1, C.tongue);
  // outline
  strokeRoundRect(img, 3, 5, 26, 22, 10, 1, C.outline);
  return img;
}

function makeTail() {
  const img = makeCanvas(32, 32);
  // base stub
  fillRoundRect(img, 6, 10, 18, 12, 8, C.base);
  // taper triangle-ish on the left (tail points left by default)
  for (let x = 2; x <= 10; x++) {
    const h = Math.max(1, 12 - Math.abs(x - 6) * 2);
    const y = 16 - (h >> 1);
    fillRect(img, x, y, 1, h, [C.base[0], C.base[1], C.base[2], 255]);
  }
  // highlight
  fillRoundRect(img, 9, 11, 12, 4, 4, [C.light[0], C.light[1], C.light[2], 160]);
  strokeRoundRect(img, 2, 10, 22, 12, 8, 1, C.outline);
  return img;
}

function makeTurn() {
  const img = makeCanvas(32, 32);
  // base turn connects UP and RIGHT (└ shaped path):
  // vertical piece
  fillRoundRect(img, 10, 2, 12, 20, 8, C.base);
  // horizontal piece
  fillRoundRect(img, 10, 10, 20, 12, 8, C.base);
  // inner highlight
  fillRoundRect(img, 12, 4, 7, 6, 4, [C.light[0], C.light[1], C.light[2], 150]);
  fillRoundRect(img, 12, 12, 10, 5, 4, [C.light[0], C.light[1], C.light[2], 120]);
  // outline-ish
  strokeRoundRect(img, 10, 2, 12, 20, 8, 1, C.outline);
  strokeRoundRect(img, 10, 10, 20, 12, 8, 1, C.outline);
  return img;
}

function writeSprite(name, img) {
  const png = encodePngRGBA(img);
  fs.writeFileSync(path.join(OUT_DIR, name), png);
}

function makeApple() {
  const img = makeCanvas(32, 32);
  const red = [235, 69, 90, 255];
  const red2 = [255, 121, 129, 220];
  const stem = [90, 65, 45, 255];
  const leaf = [63, 200, 110, 255];

  fillRoundRect(img, 7, 8, 18, 18, 9, red);
  fillCircle(img, 16, 10, 7, red);
  // highlight
  fillRoundRect(img, 10, 11, 6, 10, 4, [red2[0], red2[1], red2[2], 120]);
  // stem
  fillRoundRect(img, 15, 4, 3, 6, 2, stem);
  // leaf
  fillRoundRect(img, 18, 5, 8, 4, 3, [leaf[0], leaf[1], leaf[2], 230]);
  strokeRoundRect(img, 7, 8, 18, 18, 9, 1, C.outline);
  return img;
}

function makeMango() {
  const img = makeCanvas(32, 32);
  const yellow = [255, 209, 102, 255];
  const orange = [255, 170, 64, 255];
  const green = [110, 220, 140, 255];

  // mango body (slanted oval-ish)
  fillRoundRect(img, 7, 7, 18, 20, 10, yellow);
  fillRoundRect(img, 10, 9, 16, 18, 9, [orange[0], orange[1], orange[2], 160]);
  // small green tip
  fillRoundRect(img, 6, 9, 6, 6, 4, [green[0], green[1], green[2], 210]);
  // highlight
  fillRoundRect(img, 12, 11, 6, 11, 4, [255, 255, 255, 70]);
  strokeRoundRect(img, 7, 7, 18, 20, 10, 1, C.outline);
  return img;
}

function makeRock() {
  const img = makeCanvas(32, 32);
  const g1 = [154, 164, 178, 255];
  const g2 = [120, 130, 145, 255];
  const g3 = [190, 198, 210, 200];

  // chunky rock
  fillRoundRect(img, 6, 10, 20, 16, 6, g1);
  fillRoundRect(img, 9, 12, 18, 14, 6, [g2[0], g2[1], g2[2], 170]);
  // facets
  fillRoundRect(img, 10, 13, 7, 5, 3, [g3[0], g3[1], g3[2], 160]);
  fillRoundRect(img, 18, 17, 6, 4, 3, [255, 255, 255, 45]);
  strokeRoundRect(img, 6, 10, 20, 16, 6, 1, C.outline);
  return img;
}

writeSprite('body.png', makeBody());
writeSprite('head.png', makeHead());
writeSprite('tail.png', makeTail());
writeSprite('turn.png', makeTurn());

writeSprite('apple.png', makeApple());
writeSprite('mango.png', makeMango());
writeSprite('rock.png', makeRock());

console.log('Wrote sprites to', OUT_DIR);
