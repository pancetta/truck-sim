// A map's ground (#104): its height in m above sea level, from the map's height grid (npm run maps, scripts/maps.js),
// { minX, minZ, cell, nx, nz, h } with h row by row from minZ (z, then x), bilinear between the grid points and clamped
// at the grid's edge. A map without a grid (the inline test fixtures) is flat at 0.
export function createTerrain(grid) {
  if (!grid) return { heightAt: () => 0, slopeAt: () => 0 };
  const { minX, minZ, cell, nx, nz, h } = grid;
  const heightAt = (x, z) => {
    const i = Math.min(nx - 1.0001, Math.max(0, (x - minX) / cell));
    const j = Math.min(nz - 1.0001, Math.max(0, (z - minZ) / cell));
    const i0 = Math.floor(i); // scalars, not destructured pairs: AI cars sample it every step (#109)
    const j0 = Math.floor(j);
    const u = i - i0;
    const v = j - j0;
    const k = j0 * nx + i0;
    return (h[k] * (1 - u) + h[k + 1] * u) * (1 - v) + (h[k + nx] * (1 - u) + h[k + nx + 1] * u) * v;
  };
  // The ground's rise per m along the unit direction (dx, dz) at (x, z), measured `span` m either side.
  const slopeAt = (x, z, dx, dz, span = 1) => (heightAt(x + dx * span, z + dz * span) - heightAt(x - dx * span, z - dz * span)) / (2 * span);
  return { heightAt, slopeAt };
}
