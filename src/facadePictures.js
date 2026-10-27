// The pictures on the buildings' facade parts (buildings.js), our own, painted on one canvas at load: glass with
// curtains or blinds, a louvred shutter leaf, a wooden double door, a pulled-down shop shutter, a shop window, a plain
// white patch for stone and painted parts. Mostly light, neutral tones, which a part's
// colour multiplies (shutter green, door wood).
import * as THREE from 'three/webgpu';

export const ATLAS = 1024; // px, the canvas is square
const ROUGH = 16; // the roughness canvas is this many times smaller
const PICTURES = ['glass0', 'glass1', 'glass2', 'glass3', 'louvre', 'door', 'roller', 'shop'];
// Roughness per picture and the plain patch.
const ROUGHNESS = { glass0: 0.1, glass1: 0.1, glass2: 0.1, glass3: 0.1, shop: 0.1, roller: 0.45, louvre: 0.6, door: 0.7, plain: 0.8 };

// Where each picture sits on the canvas, px: name -> [x, y, width, height]. The pictures are 128 × 256 cells along the
// top; the plain patch is a 128 px square below them.
export function atlasCells() {
  return { ...Object.fromEntries(PICTURES.map((name, i) => [name, [i * 128, 0, 128, 256]])), plain: [0, 256, 128, 128] };
}

// The colour texture and a roughness map on the same layout, for a MeshStandardMaterial with vertex colours.
export function paintFacadePictures(cells) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d');
  const rough = document.createElement('canvas');
  rough.width = rough.height = ATLAS / ROUGH;
  const r = rough.getContext('2d');
  for (const [name, [x, y, w, h]] of Object.entries(cells)) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    (PAINT[name] ?? PAINT.plain)(g, w, h);
    g.restore();
    const level = Math.round((ROUGHNESS[name] ?? ROUGHNESS.plain) * 255);
    r.fillStyle = `rgb(${level}, ${level}, ${level})`;
    r.fillRect(x / ROUGH, y / ROUGH, w / ROUGH, h / ROUGH);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  // Each part samples one cell, so the roughness never needs blending across cells.
  const roughnessMap = Object.assign(new THREE.CanvasTexture(rough), { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  return { map, roughnessMap };
}

// Glass behind a painted casement (dark panes with a sky-ish sheen; white frame, mullion and transom). Variants: 0 plain,
// 1 sheer curtains, 2 blinds half down, 3 curtains drawn with a gap.
const glass = (variant) => (g, w, h) => {
  const sheen = g.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, '#3a4757');
  sheen.addColorStop(0.5, '#1c232c');
  sheen.addColorStop(1, '#262f3a');
  g.fillStyle = sheen;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(232, 226, 210, 0.85)';
  if (variant === 1) for (const x of [10, w / 2 + 4]) g.fillRect(x, 10, w / 2 - 14, h - 20);
  if (variant === 2) for (let y = 10; y < h * 0.55; y += 6) g.fillRect(8, y, w - 16, 4);
  if (variant === 3) for (const x of [8, w / 2 + 14]) g.fillRect(x, 8, w / 2 - 22, h - 16);
  if (variant === 1 || variant === 3) {
    g.fillStyle = 'rgba(0, 0, 0, 0.18)'; // curtain folds
    for (let x = 12; x < w - 8; x += 9) g.fillRect(x, 10, 3, h - 20);
  }
  g.fillStyle = '#efece4';
  g.fillRect(0, 0, w, 8);
  g.fillRect(0, h - 8, w, 8);
  g.fillRect(0, 0, 8, h);
  g.fillRect(w - 8, 0, 8, h);
  g.fillRect(w / 2 - 3, 0, 6, h); // mullion between the two casements
  g.fillRect(0, h * 0.28, w, 6); // transom
};

const PAINT = {
  glass0: glass(0),
  glass1: glass(1),
  glass2: glass(2),
  glass3: glass(3),
  plain: (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
  },
  // Louvred shutter leaf: slats with a shadow line each, inside a frame with a middle rail.
  louvre: (g, w, h) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 7) {
      g.fillStyle = '#b8b8b8';
      g.fillRect(6, y + 4, w - 12, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(6, y, w - 12, 1);
    }
    g.strokeStyle = '#9a9a9a';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#d6d6d6';
    g.fillRect(4, h / 2 - 5, w - 8, 10);
  },
  // Wooden double door: two leaves of three raised panels each, a brass knob per leaf.
  door: (g, w, h) => {
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = `rgba(0, 0, 0, ${0.03 + ((x * 7) % 5) * 0.012})`; // grain
      g.fillRect(x, 0, 2, h);
    }
    for (const left of [8, w / 2 + 4]) {
      for (const [top, ph] of [[12, 60], [80, 80], [170, 74]]) {
        g.fillStyle = 'rgba(0, 0, 0, 0.28)';
        g.fillRect(left, top, w / 2 - 12, ph);
        g.fillStyle = 'rgba(255, 255, 255, 0.35)';
        g.fillRect(left + 4, top + 4, w / 2 - 20, ph - 8);
        g.fillStyle = '#d0d0d0';
        g.fillRect(left + 7, top + 7, w / 2 - 26, ph - 14);
      }
    }
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(w / 2 - 1, 0, 2, h);
    g.fillStyle = '#e8c56a';
    for (const x of [w / 2 - 10, w / 2 + 10]) {
      g.beginPath();
      g.arc(x, h * 0.55, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  },
  // Pulled-down shop shutter: ribbed metal with a darker bottom bar and a lock.
  roller: (g, w, h) => {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      g.fillStyle = '#a8a8a8';
      g.fillRect(0, y + 3, w, 2);
    }
    g.fillStyle = '#7a7a7a';
    g.fillRect(0, h - 12, w, 12);
    g.fillRect(w / 2 - 6, h - 18, 12, 6);
  },
  // Shop window: shelves of goods behind the glass, a reflection across it, a light frame.
  shop: (g, w, h) => {
    g.fillStyle = '#4a4036';
    g.fillRect(0, 0, w, h);
    const goods = ['#b8a27a', '#8c5a3c', '#d8cbb0', '#5d6b55', '#a34c3a', '#c9b48a'];
    for (let y = 18; y < h - 20; y += 34) {
      g.fillStyle = '#2c241e';
      g.fillRect(6, y + 24, w - 12, 4); // shelf
      for (let x = 10; x < w - 14; x += 9 + ((x * 13 + y) % 7)) {
        const tall = 8 + ((x * y) % 13);
        g.fillStyle = goods[(x + y) % goods.length];
        g.fillRect(x, y + 24 - tall, 6, tall);
      }
    }
    g.fillStyle = 'rgba(255, 255, 255, 0.12)';
    g.beginPath();
    g.moveTo(0, h * 0.7);
    g.lineTo(w * 0.6, 0);
    g.lineTo(w, 0);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = '#e6e2d8';
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, 0, 5, h);
    g.fillRect(w - 5, 0, 5, h);
  },
};
