import { camera } from '../src/tables.js';

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
  { id: 'floor_pavement', type: 'texture', res: '1k' },
  { id: 'street_lamp_02', type: 'model', res: '1k', far: 0.05 },
  { id: 'jacaranda_tree', type: 'tree', res: '1k', picture: 1024 },
  { id: 'tree_small_02', type: 'tree', res: '1k', picture: 512 },
  { id: 'searsia_lucida', type: 'tree', res: '1k', picture: 512 },
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

// The Monti map (spec #59): OpenStreetMap data (© OpenStreetMap contributors, ODbL), the prototype's Overpass extracts
// in data/osm/, which `npm run maps` (scripts/maps.js) trims to the tags the game uses (`keep`, by element kind) and
// projects to metres, equirectangular round `origin` ([lat, lon]): x east, z south. `bbox` ([south, west, north, east])
// is the box the extract was taken in, whose edge is the map's. ring.json is already in metres round the same origin
// (made by prototype-monti-ring.py on that branch); of its buildings, those within `reach` m of the map's edge are kept
// (the camera draws nothing further away, tables.camera.fog), and none that reaches into the map, which has its own.
export const maps = {
  origin: [41.89525, 12.49225],
  bbox: [41.892, 12.487, 41.8985, 12.4975],
  files: [
    { source: 'data/osm/monti-osm.json', out: 'maps/monti.json', keep: { highway: ['highway', 'name', 'oneway', 'tunnel', 'area'], building: ['building', 'height', 'building:levels'] } },
    { source: 'data/osm/monti-furniture.json', out: 'maps/monti-furniture.json', keep: { natural: ['natural'], amenity: ['amenity'], barrier: ['barrier'] } },
    { source: 'data/osm/ring.json', out: 'maps/monti-ring.json', reach: camera.fog[1] },
  ],
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
