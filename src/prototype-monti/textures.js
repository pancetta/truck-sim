// PROTOTYPE (throwaway): window, shutter, door and facade pictures painted on canvases at load. They are drawn in
// light, mostly neutral tones where a per-instance colour (shutter green, door wood) multiplies them.
import * as THREE from 'three/webgpu';

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = [w, h];
  draw(canvas.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Glass behind a painted casement: dark panes with a sky-ish sheen, white frame, mullion and transom.
// Variants: 0 plain, 1 sheer curtains, 2 blinds half down, 3 curtains drawn with a gap.
export function glassTextures() {
  return [0, 1, 2, 3].map((variant) =>
    canvasTexture(128, 224, (g, w, h) => {
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
      if (variant !== 2) {
        g.fillStyle = 'rgba(0, 0, 0, 0.18)'; // curtain folds
        if (variant) for (let x = 12; x < w - 8; x += 9) g.fillRect(x, 10, 3, h - 20);
      }
      g.fillStyle = '#efece4';
      g.fillRect(0, 0, w, 8); // frame
      g.fillRect(0, h - 8, w, 8);
      g.fillRect(0, 0, 8, h);
      g.fillRect(w - 8, 0, 8, h);
      g.fillRect(w / 2 - 3, 0, 6, h); // mullion between the two casements
      g.fillRect(0, h * 0.28, w, 6); // transom
    }),
  );
}

// Louvred shutter leaf ("persiana"): slats with a shadow line each, inside a frame with a middle rail.
export const louvreTexture = () =>
  canvasTexture(64, 192, (g, w, h) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 8; y += 7) {
      g.fillStyle = '#b8b8b8';
      g.fillRect(6, y + 4, w - 12, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(6, y, w - 12, 1);
    }
    g.strokeStyle = '#9a9a9a';
    g.lineWidth = 5;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#d6d6d6';
    g.fillRect(4, h / 2 - 4, w - 8, 8);
  });

// Wooden double door ("portone"): two leaves of three raised panels each, a brass knob per leaf.
export const doorTexture = () =>
  canvasTexture(128, 224, (g, w, h) => {
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 4) {
      g.fillStyle = `rgba(0, 0, 0, ${0.03 + ((x * 7) % 5) * 0.012})`; // grain
      g.fillRect(x, 0, 2, h);
    }
    for (const left of [8, w / 2 + 4]) {
      for (const [top, ph] of [[10, 52], [70, 70], [148, 66]]) {
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
  });

// Pulled-down shop shutter ("saracinesca"): ribbed metal with a darker bottom bar.
export const rollerTexture = () =>
  canvasTexture(128, 192, (g, w, h) => {
    g.fillStyle = '#e4e4e4';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 5) {
      g.fillStyle = '#a8a8a8';
      g.fillRect(0, y + 3, w, 2);
    }
    g.fillStyle = '#7a7a7a';
    g.fillRect(0, h - 10, w, 10);
    g.fillRect(w / 2 - 6, h - 16, 12, 6); // lock
  });

// Shop window: a lit interior of shelves and goods behind the glass.
export const shopTexture = () =>
  canvasTexture(128, 160, (g, w, h) => {
    g.fillStyle = '#4a4036';
    g.fillRect(0, 0, w, h);
    const goods = ['#b8a27a', '#8c5a3c', '#d8cbb0', '#5d6b55', '#a34c3a', '#c9b48a'];
    for (let y = 18; y < h - 20; y += 30) {
      g.fillStyle = '#2c241e';
      g.fillRect(6, y + 22, w - 12, 4); // shelf
      for (let x = 10; x < w - 14; x += 9 + ((x * 13 + y) % 7)) {
        g.fillStyle = goods[(x + y) % goods.length];
        g.fillRect(x, y + 22 - (8 + ((x * y) % 13)), 6, 8 + ((x * y) % 13));
      }
    }
    g.fillStyle = 'rgba(255, 255, 255, 0.12)'; // reflection
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
  });

// One arch (4.5 m) by one arcade storey (10 m) for the ring's monuments: travertine piers, a dark arch, a cornice.
export const arcadeTexture = () =>
  canvasTexture(64, 142, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 9) {
      g.fillStyle = 'rgba(0, 0, 0, 0.06)'; // stone courses
      g.fillRect(0, y, w, 1);
    }
    g.fillStyle = '#3a3630';
    g.beginPath();
    g.moveTo(12, h);
    g.lineTo(12, 52);
    g.arc(w / 2, 52, w / 2 - 12, Math.PI, 0);
    g.lineTo(w - 12, h);
    g.fill();
    g.fillStyle = '#d9d2c2';
    g.fillRect(0, 0, w, 10); // cornice
    g.fillRect(4, 12, 4, h - 12); // half-columns
    g.fillRect(w - 8, 12, 4, h - 12);
  });

// One window bay (3.2 m) by one floor (3.5 m) for the background ring: plaster, a dark window with shutters ajar.
export const facadeTexture = () =>
  canvasTexture(64, 70, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e9e4da';
    g.fillRect(19, 16, 26, 40); // surround
    g.fillStyle = '#2a3038';
    g.fillRect(23, 20, 18, 34);
    g.fillStyle = '#8f9a86'; // shutters, tinted with the wall
    g.fillRect(11, 20, 8, 34);
    g.fillRect(45, 20, 8, 34);
    g.fillStyle = '#d8d2c6';
    g.fillRect(17, 56, 30, 3); // sill
  });
