// The game's downloaded assets: what `npm run assets` (scripts/assets.js) fetches from Poly Haven (all CC0) into
// assets-src/ and turns into the files under public/, and the budget public/ must fit (scripts/assets.test.js).
//   hdri:    the sky, public/textures/<id>_<res>.ktx2 (UASTC HDR, no mipmaps), and <id>_<first>.ktx2 at the smaller
//            resolution `first`, which the first frame waits for instead
//   texture: a PBR material, public/textures/<id>_<map>.ktx2 for each of MAPS
//   model:   public/models/<id>.glb and a far copy <id>_far.glb with `far` of the triangles, both with KTX2 textures
//            and meshopt-compressed geometry (GLTFLoader needs a KTX2Loader and the MeshoptDecoder)
//   tree:    public/textures/<id>.ktx2, the model rendered side-on into a `picture` px square, for crossed quads;
//            its span and trunk position go to src/assetInfo.json
// `res` is the Poly Haven resolution fetched (1k, 2k, ...).
export const assets = [
  { id: 'kloofendal_48d_partly_cloudy_puresky', type: 'hdri', res: '2k', first: '1k' },
  { id: 'asphalt_02', type: 'texture', res: '1k' },
  { id: 'cobblestone_square', type: 'texture', res: '1k' },
  { id: 'painted_plaster_wall', type: 'texture', res: '1k' },
  { id: 'worn_plaster_wall', type: 'texture', res: '1k' },
  { id: 'red_brick_03', type: 'texture', res: '1k' },
  { id: 'clay_roof_tiles_02', type: 'texture', res: '1k' },
  { id: 'covered_car', type: 'model', res: '1k', far: 0.08 },
];

// A texture's maps, as Poly Haven names them: colour, OpenGL normal, packed ambient occlusion / roughness / metalness.
export const MAPS = { Diffuse: 'colour', nor_gl: 'normal', arm: 'data' };

// Basis (ktx2-encoder) settings per kind of map. ETC1S: UASTC came out larger than the JPGs. The encoder marks a
// texture sRGB unless told otherwise, and three then decodes it as colour.
export const encoding = {
  colour: { isUASTC: false, qualityLevel: 128, isPerceptual: true, isSetKTX2SRGBTransferFunc: true },
  normal: { isUASTC: false, qualityLevel: 128, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  data: { isUASTC: false, qualityLevel: 128, isPerceptual: false, isSetKTX2SRGBTransferFunc: false },
  hdr: { isHDR: true, imageType: 'hdr', isUASTC: true, needSupercompression: true },
};

export const budget = {
  bytes: 12e6, // everything under public/, which the site serves next to the code
};

// The files an asset becomes, relative to public/.
export function outputs({ id, type, res, first }) {
  if (type === 'hdri') return [first, res].filter(Boolean).map((r) => `textures/${id}_${r}.ktx2`);
  if (type === 'texture') return Object.keys(MAPS).map((map) => `textures/${id}_${map}.ktx2`);
  if (type === 'model') return [`models/${id}.glb`, `models/${id}_far.glb`];
  return [`textures/${id}.ktx2`];
}
