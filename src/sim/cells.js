// A spatial cell index over world positions: items filed under every square cell of `size` m their bounding box
// spans, so a query only looks at items near it. An edge on a cell border counts the cell beyond too, so boxes that
// overlap always share a cell.
// shortcut: cell keys pack both cell numbers into one, so it holds within ±32768 cells of the origin (±458 km at 14 m).
export function createCells(size) {
  const cells = new Map();
  const key = (cx, cz) => (cx + 32768) * 65536 + cz + 32768;

  function add(item, minX, minZ, maxX, maxZ) {
    for (let cz = Math.floor(minZ / size); cz <= Math.floor(maxZ / size); cz++) {
      for (let cx = Math.floor(minX / size); cx <= Math.floor(maxX / size); cx++) {
        const k = key(cx, cz);
        (cells.get(k) ?? cells.set(k, []).get(k)).push(item);
      }
    }
  }

  // Whether `test` holds for any item filed in the cells the box spans; stops at the first. An item spanning
  // several of those cells may be tested more than once.
  function some(minX, minZ, maxX, maxZ, test) {
    for (let cz = Math.floor(minZ / size); cz <= Math.floor(maxZ / size); cz++) {
      for (let cx = Math.floor(minX / size); cx <= Math.floor(maxX / size); cx++) {
        const list = cells.get(key(cx, cz));
        if (list) for (const item of list) if (test(item)) return true;
      }
    }
    return false;
  }

  return { add, some };
}
