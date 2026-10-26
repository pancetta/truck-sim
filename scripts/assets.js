// npm run assets: downloads the assets listed in assets.config.js from Poly Haven into assets-src/ (gitignored, kept
// between runs and checked against Poly Haven's md5), turns them into the files the game loads under public/, writes
// src/assetInfo.json and the generated list in CREDITS.md. Commit what it writes; never the sources.
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import sharp from 'sharp';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, meshopt, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { createServer } from 'vite';
import { assets, encoding, MAPS, outputs } from './assets.config.js';

const API = 'https://api.polyhaven.com';
// Poly Haven asks API users to identify themselves.
const HEADERS = { 'User-Agent': 'truck-sim asset pipeline (https://github.com/pancetta/truck-sim)' };
const SRC = 'assets-src';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FAR_TEXTURE = 256; // px, the far copies' textures

const md5 = (data) => createHash('md5').update(data).digest('hex');
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

async function api(path) {
  const response = await fetch(API + path, { headers: HEADERS });
  if (!response.ok) throw new Error(`${API}${path}: HTTP ${response.status}`);
  return response.json();
}

// A Poly Haven file in assets-src/, downloaded unless the copy there has the right md5.
async function download({ url, md5: sum }, path) {
  if (existsSync(path) && md5(await readFile(path)) === sum) return path;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (md5(data) !== sum) throw new Error(`${url}: md5 mismatch`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return path;
}

// A glTF model with its buffer and textures; returns the .gltf's path.
async function downloadModel(files, id, res) {
  const { gltf } = files.gltf[res];
  const dir = join(SRC, id);
  await Promise.all(Object.entries(gltf.include).map(([path, file]) => download(file, join(dir, path))));
  return download(gltf, join(dir, `${id}_${res}.gltf`));
}

// Pictures are flipped to the row order TextureLoader and HDRLoader upload (flipY), which KTX2 textures can't do on
// upload, so UVs, the sky's up and a normal map's green channel still agree. glTF textures aren't flipped.
async function encode(out, source, options) {
  const data = await encodeToKTX2(source, { generateMipmap: true, isKTX2File: true, isYFlip: true, imageDecoder, ...options });
  await writeFile(join('public', out), data);
  return data;
}

// glTF textures, by material slot: colour in sRGB, normals tuned as such, the rest as plain data.
const modelTextures = [
  ktx2({ ...encoding.colour, slots: /baseColor|emissive/, generateMipmap: true, isKTX2File: true, imageDecoder }),
  ktx2({ ...encoding.normal, slots: /normal/, generateMipmap: true, isKTX2File: true, imageDecoder }),
  ktx2({ ...encoding.data, slots: /occlusion|metallicRoughness/, generateMipmap: true, isKTX2File: true, imageDecoder }),
];

const steps = {
  async hdri({ id, res, first }, files, info) {
    for (const r of [first, res].filter(Boolean)) {
      const source = await download(files.hdri[r].hdr, join(SRC, id, `${id}_${r}.hdr`));
      const out = `textures/${id}_${r}.ktx2`;
      const data = await encode(out, await readFile(source), { ...encoding.hdr, generateMipmap: false });
      // Values above half-float range make the encoder scale the whole image down and record the way back in the
      // KTXmapRange key (float32 scale, then offset); the game applies the scale. Read from the bytes: ktx-parse
      // decodes the binary value as text.
      const key = Buffer.from(data).indexOf('KTXmapRange\0');
      if (key >= 0) info[out] = { scale: Buffer.from(data).readFloatLE(key + 12) };
    }
  },

  async texture({ id, res }, files) {
    for (const [map, kind] of Object.entries(MAPS)) {
      const source = await download(files[map][res].jpg, join(SRC, id, `${id}_${map}_${res}.jpg`));
      await encode(`textures/${id}_${map}.ktx2`, await readFile(source), encoding[kind]);
    }
  },

  async model({ id, res, far }, files) {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    const near = await io.read(await downloadModel(files, id, res));
    await near.transform(dedup(), weld());
    const low = cloneDocument(near);
    await low.transform(simplify({ simplifier: MeshoptSimplifier, ratio: far, error: 0.01 }), textureCompress({ encoder: sharp, resize: [FAR_TEXTURE, FAR_TEXTURE] }));
    for (const [document, out] of [[near, `models/${id}.glb`], [low, `models/${id}_far.glb`]]) {
      await document.transform(...modelTextures, meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      await io.write(join('public', out), document);
    }
  },

  // Rendered by scripts/bake-tree.html in headless Chrome: side-on, flatly lit, on a transparent background.
  async tree({ id, res, picture }, files, info, bakeUrl) {
    const gltf = await downloadModel(files, id, res);
    const { min, max } = getBounds((await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(gltf)).getRoot().getDefaultScene());
    const span = Math.max(max[0] - min[0], max[1] - min[1]); // m, the picture's width and height
    const left = (min[0] + max[0]) / 2 - span / 2;
    const png = join(SRC, id, `${id}.png`);
    const query = new URLSearchParams({ model: `../${gltf}`, left, bottom: min[1], span, size: picture });
    await promisify(execFile)(CHROME, [
      '--headless=new', `--window-size=${picture},${picture}`, '--default-background-color=00000000',
      '--virtual-time-budget=120000', `--screenshot=${png}`, `${bakeUrl}?${query}`,
    ]);
    const [out] = outputs({ id, type: 'tree' });
    await encode(out, await readFile(png), encoding.colour);
    info[out] = { span, trunk: -left / span }; // trunk: where the model's origin (its trunk foot) is across the picture, 0..1
  },
};

// The generated part of CREDITS.md, between these markers.
async function writeCredits(entries) {
  const [start, end] = ['<!-- assets:start -->', '<!-- assets:end -->'];
  const credits = await readFile('CREDITS.md', 'utf8');
  const rows = entries.map(({ asset: { id, type, res }, meta }) =>
    `| ${meta.name} (${type}, ${res}) by ${Object.keys(meta.authors).join(', ')} | ${outputs({ id, type }).map((f) => `\`public/${f}\``).join(', ')} | https://polyhaven.com/a/${id} | CC0 1.0 |`);
  const table = ['| Asset | Files | Source | Licence |', '|---|---|---|---|', ...rows].join('\n');
  const [before, rest] = credits.split(start);
  if (rest === undefined || !rest.includes(end)) throw new Error(`CREDITS.md needs the markers ${start} and ${end}`);
  await writeFile('CREDITS.md', `${before}${start}\n${table}\n${end}${rest.split(end)[1]}`);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const info = {};
const entries = [];
// The bake page needs a dev server; it's only started when a tree is listed.
const server = assets.some((a) => a.type === 'tree') ? await (await createServer({ logLevel: 'error', server: { port: 5199 } })).listen() : null;
try {
  for (const asset of assets) {
    console.log(`${asset.id} (${asset.type})`);
    const [files, meta] = await Promise.all([api(`/files/${asset.id}`), api(`/info/${asset.id}`)]);
    await steps[asset.type](asset, files, info, server && `${server.resolvedUrls.local[0]}scripts/bake-tree.html`);
    entries.push({ asset, meta });
  }
} finally {
  await server?.close();
}
// three's Basis transcoder, served for its KTX2Loader.
await rm('public/basis', { recursive: true, force: true });
await mkdir('public/basis');
for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(`node_modules/three/examples/jsm/libs/basis/${file}`, `public/basis/${file}`);
await writeFile('src/assetInfo.json', `${JSON.stringify(info, null, 2)}\n`);
await writeCredits(entries);
console.log('Done. Commit public/, src/assetInfo.json and CREDITS.md.');
