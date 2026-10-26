# PROTOTYPE (throwaway). Usage: python3 -I prototype-monti-ring.py <overpass ring.json> public/prototype-monti/monti-osm.json public/prototype-monti/ring.json
# The Overpass query (out body geom) is in the round-4 commit message.
# Compacts the Overpass ring download into rings in local metres for the prototype's background buildings.
import json, math, re, sys

src, detailed, out = sys.argv[1], sys.argv[2], sys.argv[3]
LAT0, LON0 = 41.89525, 12.49225
M_LAT, M_LON = 110574, 111320 * math.cos(math.radians(LAT0))
def xz(p): return (round((p['lon'] - LON0) * M_LON, 1), round(-(p['lat'] - LAT0) * M_LAT, 1))

def num(v):
    m = re.match(r'\s*([0-9.]+)', v or '')
    return float(m.group(1)) if m else None

def stitch(ways):
    # Joins member ways into closed rings by shared end points.
    ways = [list(w) for w in ways if len(w) > 1]
    rings = []
    while ways:
        ring = ways.pop(0)
        while ring[0] != ring[-1]:
            for i, w in enumerate(ways):
                if w[0] == ring[-1]: ring += w[1:]
                elif w[-1] == ring[-1]: ring += w[::-1][1:]
                elif w[-1] == ring[0]: ring = w[:-1] + ring
                elif w[0] == ring[0]: ring = w[::-1][:-1] + ring
                else: continue
                ways.pop(i)
                break
            else:
                break
        if ring[0] == ring[-1] and len(ring) > 3: rings.append(ring[:-1])
    return rings

skip = {e['id'] for e in json.load(open(detailed))['elements'] if e['type'] == 'way'}
items = []
for e in json.load(open(src))['elements']:
    t = e.get('tags', {})
    if e['type'] == 'way':
        if e['id'] in skip or len(e['geometry']) < 4 or e['geometry'][0] != e['geometry'][-1]: continue
        outer, inner = [[xz(p) for p in e['geometry'][:-1]]], []
    else:
        outer = stitch([[xz(p) for p in m['geometry']] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m])
        inner = stitch([[xz(p) for p in m['geometry']] for m in e.get('members', []) if m.get('role') == 'inner' and 'geometry' in m])
        if not outer: continue
    part = 'building:part' in t and t.get('building:part') != 'no'
    kind = t.get('building:part') if part else t.get('building')
    if kind == 'roof': continue
    levels = num(t.get('building:levels'))
    height = num(t.get('height')) or (levels * 3.5 + 1 if levels else {'church': 22, 'basilica': 30, 'cathedral': 30, 'amphitheatre': 48}.get(kind, 17))
    base = num(t.get('min_height')) or (num(t.get('building:min_level')) or 0) * 3.5
    dome = t.get('roof:shape') == 'dome'
    roof_h = num(t.get('roof:height'))
    for ring in outer:
        items.append({'part': part, 'r': ring, 'h': inner if len(outer) == 1 else [], 'top': round(height, 1), 'base': round(base, 1),
                      **({'dome': roof_h or True} if dome else {}), 'stone': kind in ('church', 'basilica', 'cathedral', 'amphitheatre', 'chapel')})

# Outlines that contain building parts are drawn by their parts (the OSM 3D convention).
def inside(pt, ring):
    x, z = pt; c = False
    for (x1, z1), (x2, z2) in zip(ring, ring[1:] + ring[:1]):
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: c = not c
    return c
def bbox(r): xs, zs = zip(*r); return min(xs), min(zs), max(xs), max(zs)
parts = [i for i in items if i['part']]
centre = lambda i: (sum(x for x, _ in i['r']) / len(i['r']), sum(z for _, z in i['r']) / len(i['r']))
dropped = set()
for n, i in enumerate(items):
    if not i['part']:
        x0, z0, x1, z1 = bbox(i['r'])
        inner = [p for p in parts if x0 <= centre(p)[0] <= x1 and z0 <= centre(p)[1] <= z1 and inside(centre(p), i['r'])]
        if inner:
            dropped.add(n)
            for p in inner: p['stone'] = p['stone'] or i['stone']  # a monument's parts are monument too
keep = [{k: v for k, v in i.items() if k != 'part' and v not in ([], 0, False) or k in ('top', 'base', 'r')}
        for n, i in enumerate(items) if n not in dropped]
json.dump(keep, open(out, 'w'), separators=(',', ':'))
print(len(items), 'items,', len(keep), 'kept,', sum('dome' in i for i in keep), 'domes')
