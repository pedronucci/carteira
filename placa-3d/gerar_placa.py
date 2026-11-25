import numpy as np, trimesh, uuid, zipfile, io, sys
from functools import reduce
from shapely.geometry import Polygon, MultiPolygon, box, Point
from shapely.ops import unary_union
from shapely import affinity
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

OUT = sys.argv[1]
SERIF = FontProperties(fname="/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf")
SANS  = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

def text_poly(s, font, spacing=0.0):
    # builds glyph-by-glyph so letter spacing can be added
    x = 0; geoms = []
    for ch in s:
        if ch == " ":
            x += TextPath((0,0), "n", size=10, prop=font).get_extents().width + spacing; continue
        tp = TextPath((x,0), ch, size=10, prop=font)
        polys = [Polygon(p) for p in tp.to_polygons() if len(p) >= 3]
        polys = [p.buffer(0) for p in polys]
        g = reduce(lambda a,b: a.symmetric_difference(b), polys) if polys else None
        if g is not None: geoms.append(g)
        adv = TextPath((0,0), ch+"|", size=10, prop=font).get_extents().width - TextPath((0,0), "|", size=10, prop=font).get_extents().width
        x += max(adv, tp.get_extents().width) + spacing
    return unary_union(geoms)

def fit(g, width=None, height=None, x0=0, y0=0, anchor="left"):
    minx, miny, maxx, maxy = g.bounds
    s = width/(maxx-minx) if width else height/(maxy-miny)
    g = affinity.scale(g, s, s, origin=(0,0))
    minx, miny, maxx, maxy = g.bounds
    dx = x0-minx if anchor=="left" else x0-(minx+maxx)/2
    return affinity.translate(g, dx, y0-miny)

def clean(g): 
    g = g.buffer(0.002, join_style=2).buffer(-0.002, join_style=2)
    return g

# ---------------- layout (mm) ----------------
T  = 6.0     # panel thickness (black body)
R1 = 1.2     # raised text height
PX0, PX1, PY1 = 48, 210, 50   # panel
# Badge shield
bw, bh, bx = 60, 74, 0
cx = bx + bw/2
pts = [(bx, 62), (bx+4, 68), (cx-12, 70), (cx-6, 74), (cx, 71), (cx+6, 74), (cx+12, 70), (bx+bw-4, 68), (bx+bw, 62),
       (bx+bw, 34)]
# lower curve to point
for t in np.linspace(0, 1, 14)[1:]:
    a = t*np.pi/2
    pts.append((cx + (bw/2)*np.cos(a), 34 - 30*np.sin(a)**1.25))
pts += [(cx, 2)]
for t in np.linspace(1, 0, 14)[:-1]:
    a = t*np.pi/2
    pts.append((cx - (bw/2)*np.cos(a), 34 - 30*np.sin(a)**1.25))
shield = Polygon(pts).buffer(1.2).buffer(-1.2)
backing = shield.buffer(2.6, join_style=1)

panel = box(PX0, 0, PX1, PY1).difference(box(PX1-4, PY1-4, PX1, PY1)).union(Point(PX1-4, PY1-4).buffer(4))
tongue = box(PX0+4, -8, PX1-6, 0.01)

# Texts
milena = fit(text_poly("MILENA", SERIF), width=138, x0=67, y0=37)
franc  = fit(text_poly("FRANCONERE", SERIF), width=138, x0=67, y0=18)
line   = box(67, 13.6, 205, 15)
escr   = fit(text_poly("ESCRIVÃ DE POLÍCIA", SANS, spacing=2.2), width=128, x0=72, y0=3.8)
print("MILENA", milena.bounds, "FRANC", franc.bounds, "ESCR", escr.bounds)

# Badge contents
inner_line = shield.buffer(-2.2).difference(shield.buffer(-3.0))
pol  = fit(text_poly("POLÍCIA", SANS), width=40, x0=cx, y0=56, anchor="center")
civ  = fit(text_poly("CIVIL", SANS), width=32, x0=cx, y0=15, anchor="center")
sp   = fit(text_poly("SP", SANS), height=5.5, x0=cx, y0=7.5, anchor="center")
# scroll bands around POLÍCIA and CIVIL (black outlines)
def band(y0, y1, w):
    b = box(cx-w/2, y0, cx+w/2, y1)
    return b.difference(b.buffer(-0.8))
scroll1 = band(54, 66.5, 48).intersection(shield.buffer(-2))
scroll2 = band(13, 25.5, 44).intersection(shield.buffer(-2))
# coat of arms
ex, ey = cx, 39  # center
arms = Polygon([(ex-8, ey+9), (ex+8, ey+9), (ex+8, ey-2), (ex, ey-10), (ex-8, ey-2)]).buffer(0.6).buffer(-0.6)
arms_red = arms.intersection(box(ex-9, ey+2.5, ex+9, ey+10))
arms_white = arms.difference(box(ex-9, ey+2.5, ex+9, ey+10))
stripes = unary_union([box(ex-9, ey-9+i*2.6, ex+9, ey-9+i*2.6+1.3) for i in range(5)]).intersection(arms_white).intersection(box(0,0,999,ey+1.5))
arms_white = arms_white.difference(stripes)
arms_frame = arms.buffer(0.9).difference(arms)
# laurels (leaves) left/right
leaves = []
for side in (-1, 1):
    for k in range(6):
        a = np.radians(-70 + k*24)
        r = 13.5
        px, py = ex + side*r*np.cos(a), ey + r*np.sin(a)
        leaf = affinity.scale(Point(0,0).buffer(1), 0.8, 2.0)
        leaf = affinity.rotate(leaf, np.degrees(a) + (0 if side>0 else 0), origin=(0,0))
        if side < 0: leaf = affinity.scale(leaf, -1, 1, origin=(0,0))
        leaves.append(affinity.translate(leaf, px, py))
leaves = unary_union(leaves)
# ribbon (red arc under the arms)
ribbon = Point(ex, ey+16).buffer(28).difference(Point(ex, ey+16).buffer(24)).intersection(box(ex-18, 0, ex+18, ey-6))
# top ribbon red over arms
ribbon_top = box(ex-11, ey+10, ex+11, ey+13.2)

stem = Point(ex, ey).buffer(14.1).difference(Point(ex, ey).buffer(12.9)).intersection(box(0, ey-13, 999, ey+9)).difference(box(ex-4, 0, ex+4, 999))
black_raised = unary_union([inner_line, pol, civ, sp, scroll1, scroll2, stripes, arms_frame, leaves, stem]).buffer(0.01).buffer(-0.01)
red_layer = unary_union([arms_red, ribbon, ribbon_top]).difference(black_raised)
white_layer = arms_white.difference(black_raised).difference(red_layer)

# ---------------- solids ----------------
def ext(g, z0, z1):
    import manifold3d as mf
    g = clean(g)
    polys = [g] if isinstance(g, Polygon) else list(g.geoms)
    rings = []
    for p in polys:
        if p.area < 0.05: continue
        rings.append(np.array(p.exterior.coords)[:-1])
        rings += [np.array(i.coords)[:-1] for i in p.interiors]
    cs = mf.CrossSection(rings, mf.FillRule.EvenOdd)
    mm = cs.extrude(z1-z0).translate((0,0,z0)).to_mesh()
    return trimesh.Trimesh(mm.vert_properties[:, :3], mm.tri_verts, process=True)

DEPTH_M = T + 1.6
black_body2d = unary_union([panel, backing, tongue]).difference(milena)
parts = {
  "Preto - corpo":       (ext(black_body2d, 0, T), 1),
  "Dourado - MILENA":    (ext(milena, 0, DEPTH_M), 2),
  "Dourado - escudo":    (ext(shield.difference(milena), T, T+1.0), 2),
  "Dourado - linha":     (ext(line, T, T+0.8), 2),
  "Branco - FRANCONERE": (ext(franc, T, T+R1), 3),
  "Branco - cargo":      (ext(escr, T, T+0.8), 3),
  "Branco - brasao":     (ext(white_layer, T+1.0, T+1.6), 3),
  "Vermelho - brasao":   (ext(red_layer, T+1.0, T+1.6), 4),
  "Preto - detalhes":    (ext(black_raised.intersection(shield.buffer(-0.01)).buffer(0.001).buffer(-0.001), T+1.0, T+1.8), 1),
}

# Base (separate object): two tiers + slot
W = 46
L = 222
slot_dx = ((PX0+4)+(PX1-6))/2 - (backing.bounds[0]+PX1)/2
base_x0 = PX0+4 - (L - (PX1-6-(PX0+4)))/2
tier1 = trimesh.creation.box([L, W, 7]); tier1.apply_translation([0,0,3.5])
tier2 = trimesh.creation.box([L-8, W-8, 7]); tier2.apply_translation([0,0,10.5])
slot = trimesh.creation.box([(PX1-6)-(PX0+4)+0.8, T+0.4, 20]); slot.apply_translation([slot_dx, 3, 10+14-8.5])  # slot depth 8.5 from top (z=14)
import manifold3d
base = trimesh.boolean.union([tier1, tier2], engine="manifold")
base = trimesh.boolean.difference([base, slot], engine="manifold")

# chamfer-ish lead-in not needed; report
for n,(m,e) in parts.items():
    print(f"{n:22s} ext{e} watertight={m.is_watertight} vol={m.volume:8.1f} bounds={np.round(m.bounds,1).tolist()}")
print("Base watertight", base.is_watertight, np.round(base.bounds,1).tolist())

# ---------------- export ----------------
import os
os.makedirs(OUT+"/stl", exist_ok=True)
for n,(m,e) in parts.items():
    m.export(f"{OUT}/stl/placa_{n.split(' - ')[0].lower()}_{n.split(' - ')[1].lower()}.stl")
base.export(f"{OUT}/stl/base_preto.stl")

# Plate placement (A1 256x256): plaque on top, base below
allp = trimesh.util.concatenate([m for m,_ in parts.values()])
pb = allp.bounds
plaque_off = np.array([128 - (pb[0][0]+pb[1][0])/2, 150 - (pb[0][1]+pb[1][1])/2 + 0, -pb[0][2]])
base_off = np.array([128, 45, 0])

def mesh_xml(m, oid):
    v = "".join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a,b,c in m.vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a,b,c in m.faces)
    return f'<object id="{oid}" p:UUID="{uuid.uuid4()}" type="model"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>'

NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"'
def sub_model(objs):
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {NS}><metadata name="BambuStudio:3mfVersion">1</metadata><resources>{"".join(objs)}</resources><build/></model>'

ident = "1 0 0 0 1 0 0 0 1 0 0 0"
files = {}
# object 1 file: plaque parts ids 1..n ; object 2 file: base
plaque_objs = [mesh_xml(m, i+1) for i,(m,_) in enumerate(parts.values())]
files["3D/Objects/object_1.model"] = sub_model(plaque_objs)
nb = len(parts)+1
files["3D/Objects/object_2.model"] = sub_model([mesh_xml(base, nb)])
p_id, b_id = nb+1, nb+2
comps = "".join(f'<component p:path="/3D/Objects/object_1.model" objectid="{i+1}" p:UUID="{uuid.uuid4()}" transform="{ident}"/>' for i in range(len(parts)))
main = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" {NS}>
 <metadata name="Application">BambuStudio-01.10.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Placa Milena Franconere</metadata>
 <resources>
  <object id="{p_id}" p:UUID="{uuid.uuid4()}" type="model"><components>{comps}</components></object>
  <object id="{b_id}" p:UUID="{uuid.uuid4()}" type="model"><components><component p:path="/3D/Objects/object_2.model" objectid="{nb}" p:UUID="{uuid.uuid4()}" transform="{ident}"/></components></object>
 </resources>
 <build p:UUID="{uuid.uuid4()}">
  <item objectid="{p_id}" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 {plaque_off[0]:.3f} {plaque_off[1]:.3f} {plaque_off[2]:.3f}" printable="1"/>
  <item objectid="{b_id}" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 {base_off[0]:.3f} {base_off[1]:.3f} 0" printable="1"/>
 </build>
</model>'''
files["3D/3dmodel.model"] = main
files["3D/_rels/3dmodel.model.rels"] = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/3D/Objects/object_2.model" Id="rel-2" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>'''
files["_rels/.rels"] = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>'''
files["[Content_Types].xml"] = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>'''
pcfg = "".join(f'<part id="{i+1}" subtype="normal_part"><metadata key="name" value="{n}"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><metadata key="extruder" value="{e}"/></part>' for i,(n,(m,e)) in enumerate(parts.items()))
files["Metadata/model_settings.config"] = f'''<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="{p_id}"><metadata key="name" value="Placa (deitada)"/><metadata key="extruder" value="1"/>{pcfg}</object>
 <object id="{b_id}"><metadata key="name" value="Base"/><metadata key="extruder" value="1"/><part id="{nb}" subtype="normal_part"><metadata key="name" value="Base"/><metadata key="extruder" value="1"/></part></object>
 <plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value=""/><metadata key="locked" value="false"/>
  <model_instance><metadata key="object_id" value="{p_id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="1"/></model_instance>
  <model_instance><metadata key="object_id" value="{b_id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="2"/></model_instance>
 </plate>
</config>'''
with zipfile.ZipFile(f"{OUT}/placa_milena_franconere.3mf", "w", zipfile.ZIP_DEFLATED) as z:
    for k,v in files.items(): z.writestr(k, v)

# ---------------- preview (top view, colors) ----------------
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
col = {1:"#151515", 2:"#e8a530", 3:"#f2f2ee", 4:"#d42020"}
fig, ax = plt.subplots(figsize=(14,6), dpi=130); ax.set_facecolor("#7a4a2a")
order = sorted(parts.items(), key=lambda kv: kv[1][0].bounds[1][2])
for n,(m,e) in order:
    # project top faces
    top = m.faces[(m.face_normals[:,2] > 0.9)]
    for f in top:
        ax.fill(*m.vertices[f][:, :2].T, color=col[e], lw=0.2, ec=col[e])
ax.set_aspect("equal"); ax.axis("off"); plt.tight_layout()
plt.savefig(f"{OUT}/preview.png", facecolor="#7a4a2a")
