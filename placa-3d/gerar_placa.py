"""
Gerador da placa de mesa "MILENA FRANCONERE - Escrivã de Polícia" (Bambu Lab A1).

Uso: python3 gerar_placa.py <pasta_saida>

Modelo em "fatias" de 0,2 mm (uma camada de impressão): cada região 2D recebe
uma cor numa faixa de altura; o que é adicionado depois sobrepõe o anterior.
Assim as cores nunca se sobrepõem e as alturas casam com as camadas.
Eixos da placa: x = largura, y = altura (em pé), z = espessura (frente = +z).
A placa é impressa deitada (costas na mesa), a base é uma peça separada.
"""
import sys, os, uuid, zipfile, math
import numpy as np
import trimesh
import manifold3d as mf
from shapely.geometry import Polygon, MultiPolygon, box, Point, LineString
from shapely.ops import unary_union
from shapely import affinity
from functools import reduce
from matplotlib.textpath import TextPath
from matplotlib.font_manager import FontProperties

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
SERIF = FontProperties(fname="/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf")
SANSB = FontProperties(fname="/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")
SANS = FontProperties(fname="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")

BLACK, GOLD, WHITE, RED = 1, 2, 3, 4
COLOR_NAME = {BLACK: "Preto", GOLD: "Dourado", WHITE: "Branco", RED: "Vermelho"}

# ------------------------------------------------------------------ escala da foto
S = 0.19                      # mm por pixel da foto original (1536x1024)
def P(px, py):                # pixel da foto -> mm (y para cima)
    return ((px - 150) * S, (718 - py) * S)
def B(cx, cy):                # recorte ampliado do distintivo (2x)
    return P(140 + cx / 2, 255 + cy / 2)
def A(ax, ay):                # recorte ampliado do brasão (4x)
    return B(140 + ax / 2, 270 + ay / 2)
SB, SA = S / 2, S / 4         # mm por pixel nos recortes

def polyB(pts): return Polygon([B(*p) for p in pts])
def polyA(pts): return Polygon([A(*p) for p in pts])
def mirrorB(pts): return [(770 - x, y) for x, y in pts]     # eixo do distintivo cx=385
def mirrorA(pts): return [(1024 - x, y) for x, y in pts]    # eixo do brasão ax=512

def clean(g):
    if g is None or g.is_empty: return Polygon()
    g = g.buffer(0)
    if isinstance(g, (Polygon, MultiPolygon)):
        parts = [g] if isinstance(g, Polygon) else list(g.geoms)
        parts = [p for p in parts if p.area > 0.02]
        return unary_union(parts) if parts else Polygon()
    return unary_union([p for p in getattr(g, "geoms", []) if isinstance(p, Polygon) and p.area > 0.02])

def smooth(pts, it=3, closed=True):
    pts = np.array(pts, float)
    for _ in range(it):
        q = np.roll(pts, -1, 0) if closed else pts[1:]
        p = pts if closed else pts[:-1]
        new = np.empty((len(p) * 2, 2))
        new[0::2] = 0.75 * p + 0.25 * q
        new[1::2] = 0.25 * p + 0.75 * q
        pts = new if closed else np.vstack([pts[0], new, pts[-1]])
    return pts

# ------------------------------------------------------------------ texto
def glyph(ch, font):
    if ch == " ":
        return Polygon(), TextPath((0, 0), "n", size=10, prop=font).get_extents().width
    tp = TextPath((0, 0), ch, size=10, prop=font)
    polys = [Polygon(p).buffer(0) for p in tp.to_polygons() if len(p) >= 3]
    g = reduce(lambda a, b: a.symmetric_difference(b), polys) if polys else Polygon()
    w_bar = TextPath((0, 0), "|", size=10, prop=font).get_extents().width
    adv = TextPath((0, 0), ch + "|", size=10, prop=font).get_extents().width - w_bar
    if ch == " ": adv = TextPath((0, 0), "n", size=10, prop=font).get_extents().width
    return g, adv

def cap_ratio(font):
    return TextPath((0, 0), "H", size=10, prop=font).get_extents().height / 10

def glyph_run(s, font, cap, spacing=0.0, sx=1.0):
    """lista de (glifo já escalado, largura de avanço) com altura de maiúscula = cap"""
    k = cap / (10 * cap_ratio(font))
    out = []
    for ch in s:
        g, adv = glyph(ch, font)
        g = affinity.scale(g, k * sx, k, origin=(0, 0))
        out.append((g, adv * k * sx + spacing))
    return out

def text_line(s, font, cap, width=None, x0=0, y0=0, center=False):
    run = glyph_run(s, font, cap)
    nat = sum(a for _, a in run) - (run[-1][1] - (run[-1][0].bounds[2] if not run[-1][0].is_empty else 0))
    sx, sp = 1.0, 0.0
    if width:
        if nat > width: sx = width / nat
        else: sp = (width - nat) / (len(s) - 1)
        run = glyph_run(s, font, cap, sp, sx)
    x, gs = 0, []
    for g, a in run:
        gs.append(affinity.translate(g, x, 0)); x += a
    g = unary_union(gs)
    minx = g.bounds[0]; maxx = g.bounds[2]
    dx = x0 - (minx + maxx) / 2 if center else x0 - minx
    return affinity.translate(g, dx, y0)

def text_arc(s, font, cap, center, R, mid_angle=0.0, smile=False, spacing=0.0, sx=1.0, fit=None):
    """texto em arco. smile=False: arco convexo (centro abaixo); True: centro acima.
    fit: comprimento de arco desejado (ajusta a largura das letras)."""
    if fit:
        run0 = glyph_run(s, font, cap, spacing, 1.0)
        sx = (fit - spacing * (len(s) - 1)) / (sum(a for _, a in run0) - spacing * len(s))
    run = glyph_run(s, font, cap, spacing, sx)
    total = sum(a for _, a in run) - spacing
    cx, cy = center
    pos, out = -total / 2, []
    for g, a in run:
        if not g.is_empty:
            gw = g.bounds[2] - g.bounds[0]
            gc = g.bounds[0] + gw / 2
            th = (pos + gc) / R + mid_angle
            g0 = affinity.translate(g, -gc, 0)
            if not smile:
                g0 = affinity.rotate(g0, -th, origin=(0, 0), use_radians=True)
                g0 = affinity.translate(g0, cx + R * math.sin(th), cy + R * math.cos(th))
            else:
                g0 = affinity.rotate(g0, th, origin=(0, 0), use_radians=True)
                g0 = affinity.translate(g0, cx + R * math.sin(th), cy - R * math.cos(th))
            out.append(g0)
        pos += a
    return unary_union(out)

def arc_band(center, r_in, r_out, half_angle, smile=False, n=80):
    cx, cy = center
    th = np.linspace(-half_angle, half_angle, n)
    sgn = -1 if smile else 1
    outer = [(cx + r_out * math.sin(t), cy + sgn * r_out * math.cos(t)) for t in th]
    inner = [(cx + r_in * math.sin(t), cy + sgn * r_in * math.cos(t)) for t in th[::-1]]
    return Polygon(outer + inner)

def outline(g, w):
    return clean(g.difference(g.buffer(-w, join_style=2)))

# ------------------------------------------------------------------ pilha de camadas
LH = 0.2
class Stack:
    def __init__(self): self.sl = {}            # k -> {cor: geom}
    def add(self, g, z0, z1, color, chamfer=0.0):
        g = clean(g)
        if g.is_empty: return
        k0, k1 = int(round(z0 / LH)), int(round(z1 / LH))
        for k in range(k0, k1):
            zc = (k + 0.5) * LH
            gk = g
            if chamfer > 0 and zc > z1 - chamfer:
                gk = clean(g.buffer(-(zc - (z1 - chamfer)), join_style=1))
                if gk.is_empty: continue
            layer = self.sl.setdefault(k, {})
            for c in list(layer):
                if c != color: layer[c] = clean(layer[c].difference(gk))
            layer[color] = clean(unary_union([layer.get(color, Polygon()), gk]))
    def solids(self):
        res = {}
        ks = sorted(self.sl)
        colors = {c for l in self.sl.values() for c in l}
        for c in colors:
            runs, cur, start = [], None, None
            for k in ks + [None]:
                g = self.sl[k].get(c, Polygon()) if k is not None else None
                same = (cur is not None and g is not None and not g.is_empty and
                        cur.symmetric_difference(g).area < 1e-3)
                if same: continue
                if cur is not None and not cur.is_empty: runs.append((cur, start, k if k is not None else ks[-1] + 1))
                cur, start = (g, k) if g is not None and not g.is_empty else (None, None)
            ms = [extrude(g, a * LH, b * LH) for g, a, b in runs]
            ms = [m for m in ms if m is not None]
            res[c] = mf.Manifold.batch_boolean(ms, mf.OpType.Add) if len(ms) > 1 else ms[0]
        return res

def extrude(g, z0, z1):
    parts = [g] if isinstance(g, Polygon) else list(g.geoms)
    rings = []
    for p in parts:
        if p.area < 0.02: continue
        rings.append(np.array(p.exterior.coords)[:-1])
        rings += [np.array(i.coords)[:-1] for i in p.interiors]
    if not rings: return None
    return mf.CrossSection(rings, mf.FillRule.EvenOdd).extrude(z1 - z0).translate((0, 0, z0))

def to_trimesh(m):
    mm = m.to_mesh()
    return trimesh.Trimesh(mm.vert_properties[:, :3], mm.tri_verts, process=False)

# ================================================================== GEOMETRIA
st = Stack()

# ---------- painel preto
T = 6.0
px0, py1 = P(300, 440)
px1, _ = P(1415, 440)
panel = box(px0, 0, px1, py1).difference(box(px1 - 5, py1 - 5, px1, py1)).union(Point(px1 - 5, py1 - 5).buffer(5, 64))
tongue = box(80, -7.5, px1 - 10, 0.5)
st.add(unary_union([panel, tongue]), 0, T, BLACK, chamfer=0.8)

# ---------- distintivo: contorno
half = [(385, 22), (345, 30), (300, 42), (250, 56), (200, 64), (150, 70), (112, 80), (80, 98),
        (56, 124), (40, 160), (32, 200), (36, 248), (46, 288), (38, 330), (27, 385), (22, 450),
        (24, 530), (34, 610), (58, 690), (98, 762), (158, 828), (228, 878), (310, 912), (385, 930)]
outer_pts = half + mirrorB(half[::-1])[1:-1]
outer_pts = [B(*p) for p in smooth(outer_pts, 3)]
badge_outer = Polygon(outer_pts).buffer(0)
face = badge_outer.buffer(-3.0, join_style=1)
ZB = 8.4      # topo do aro preto
ZF = 10.0     # topo da face dourada
st.add(badge_outer, 0, ZB, BLACK, chamfer=1.4)
st.add(face, ZB - 0.6, ZF, GOLD, chamfer=0.6)
# friso gravado (linha preta embutida rente)
st.add(outline(face.buffer(-1.8), 0.55), ZF - 0.4, ZF, BLACK)

# ---------- fita dourada "POLÍCIA"
def circle_from(top_mid, end, convex=True):
    (xm, ym), (xe, ye) = top_mid, end
    c = abs(xe - xm); h = abs(ym - ye)
    R = (c * c + h * h) / (2 * h)
    return R

tm, te = B(385, 148), B(160, 166)
R1 = circle_from(tm, te)
c1 = (tm[0], tm[1] - R1)
th1 = math.asin(abs(te[0] - tm[0]) / R1)
band1 = arc_band(c1, R1 - 120 * SB, R1, th1).intersection(face.buffer(-0.6))
tail1L = smooth([(205, 198), (108, 222), (142, 282), (110, 348), (208, 308)], 1)
tail1 = [polyB(tail1L).intersection(face.buffer(-0.6)), polyB(mirrorB(tail1L)).intersection(face.buffer(-0.6))]

tm2, te2 = B(385, 640), B(150, 617)
R2 = circle_from(tm2, te2)
c2 = (tm2[0], tm2[1] + R2)          # centro acima (sorriso)
th2 = math.asin(abs(te2[0] - tm2[0]) / R2)
band2 = arc_band(c2, R2, R2 + 132 * SB, th2, smile=True).intersection(face.buffer(-0.6))
tail2L = smooth([(210, 588), (112, 545), (142, 606), (96, 670), (200, 702)], 1)
tail2 = [polyB(tail2L).intersection(face.buffer(-0.6)), polyB(mirrorB(tail2L)).intersection(face.buffer(-0.6))]

for t in tail1 + tail2:
    st.add(t, ZF, ZF + 0.4, GOLD)
    vis = t
    st.add(outline(t, 0.5), ZF, ZF + 0.4, BLACK)
    # dobra: linha da aba até a fita
for band in (band1, band2):
    st.add(band, ZF, ZF + 0.8, GOLD)
    st.add(outline(band, 0.55), ZF + 0.4, ZF + 0.8, BLACK)

# dobras das abas (pequenos triângulos escuros)
for pts in []:
    st.add(polyB(pts).intersection(band1.union(band2).buffer(3)).difference(band1.union(band2)), ZF, ZF + 0.4, BLACK)
    st.add(polyB(mirrorB(pts)).intersection(band1.union(band2).buffer(3)).difference(band1.union(band2)), ZF, ZF + 0.4, BLACK)

capP = 84 * SB
pol = text_arc("POLÍCIA", SANSB, capP, c1, R1 - 120 * SB / 2 - capP / 2, spacing=0.5, fit=(560 - 210) * SB)
st.add(pol.buffer(0.32), ZF + 0.8, ZF + 1.4, BLACK)
capC = 94 * SB
civ = text_arc("CIVIL", SANSB, capC, c2, R2 + 132 * SB / 2 + capC / 2, smile=True, spacing=1.0, fit=(560 - 222) * SB)
st.add(civ.buffer(0.34), ZF + 0.8, ZF + 1.4, BLACK)
sp = text_line("SP", SANSB, 58 * SB, x0=B(385, 0)[0], y0=B(0, 862)[1], center=True)
st.add(sp.buffer(0.22), ZF, ZF + 0.8, BLACK)
# marquinha no topo
chev = LineString([B(368, 104), B(385, 124), B(404, 96)]).buffer(0.32, cap_style=1)
st.add(chev, ZF, ZF + 0.6, BLACK)

# ---------- louros (em dourado com contorno preto; ver LEIAME para pintar de verde)
def bez(p0, p1, p2, t):
    return ((1 - t) ** 2 * np.array(p0) + 2 * (1 - t) * t * np.array(p1) + t * t * np.array(p2))
def leaf(base, ang, L, W):
    # folha pontuda (vesica) com base em 'base' e eixo no ângulo 'ang'
    r = (L * L / 4 + W * W / 4) / W
    d = r - W / 2
    a = Point(0, -d).buffer(r, 64).intersection(Point(0, d).buffer(r, 64))
    a = affinity.rotate(a, -90, origin=(0, 0))          # eixo ao longo de x
    a = affinity.translate(a, L / 2, 0)
    a = affinity.rotate(a, ang, origin=(0, 0), use_radians=True)
    return affinity.translate(a, *base)

leaves, stems = [], []
for side in (1, -1):
    p0, p1, p2 = (415, 772), (92, 520), (236, 158)
    if side == -1: p0, p1, p2 = [(1024 - x, y) for x, y in (p0, p1, p2)]
    pts = [A(*bez(p0, p1, p2, t)) for t in np.linspace(0, 1, 60)]
    stems.append(LineString(pts).buffer(0.5, cap_style=1))
    N = 11
    for i in range(N):
        t = 0.06 + 0.88 * i / (N - 1)
        q = np.array(A(*bez(p0, p1, p2, t)))
        q2 = np.array(A(*bez(p0, p1, p2, min(t + 0.01, 1))))
        tang = math.atan2(*(q2 - q)[::-1])
        L = (108 - 34 * t) * SA; W = 0.44 * L
        for s_ in (1, -1):
            leaves.append(leaf(q, tang + s_ * math.radians(38), L, W))
    tip = np.array(A(*p2)); pre = np.array(A(*bez(p0, p1, p2, 0.97)))
    leaves.append(leaf(tip, math.atan2(*(tip - pre)[::-1]), 70 * SA, 30 * SA))
leaves_u = clean(unary_union(leaves))
for st_ in stems: st.add(st_, ZF, ZF + 0.6, BLACK)
for lf in leaves:
    st.add(lf, ZF, ZF + 0.8, GOLD, chamfer=0.2)
for lf in leaves:
    st.add(outline(lf, 0.38), ZF + 0.4, ZF + 0.8, BLACK)

# ---------- brasão de São Paulo
sh_half = [(512, 124), (494, 140), (318, 140), (318, 470), (330, 530), (365, 578), (420, 612), (512, 640)]
sh_pts = sh_half + [(1024 - x, y) for x, y in sh_half[::-1]][1:-1]
arms = polyA(sh_pts).buffer(0)
field = arms.buffer(-0.7, join_style=2)
chief = field.intersection(box(-999, A(0, 322)[1], 999, 999))
st.add(arms, ZF, ZF + 0.8, BLACK)                 # fundo / listras pretas (rebaixadas)
st.add(outline(arms, 0.75), ZF, ZF + 1.2, BLACK)  # borda preta em relevo
st.add(chief, ZF, ZF + 1.0, RED)
for y0, y1 in ((358, 398), (438, 478), (518, 553), (590, 660)):
    stripe = field.intersection(box(-999, A(0, y1)[1], 999, A(0, y0)[1]))
    st.add(stripe, ZF, ZF + 1.0, WHITE)
# emblema branco no chefe vermelho: gládio + ramos + armas cruzadas
emb = [box(*A(506, 300), *A(518, 176)) if False else Polygon([A(506, 300), A(518, 300), A(518, 182), A(512, 166), A(506, 182)])]
emb.append(polyA([(476, 268), (548, 268), (548, 282), (476, 282)]))            # guarda
emb.append(polyA([(507, 282), (517, 282), (517, 300), (507, 300)]))
emb.append(Point(*A(512, 305)).buffer(9 * SA))
for sx_, ang in ((-1, 35), (1, -35)):
    for k, (dy, L) in enumerate(((205, 60), (240, 66))):
        e = affinity.scale(Point(0, 0).buffer(1, 32), L / 2 * SA, 9 * SA)
        e = affinity.rotate(e, ang * (1 if k == 0 else 0.6), origin=(0, 0))
        emb.append(affinity.translate(e, *A(512 + sx_ * 34, dy)))
for cx_ in (388, 636):
    for ang in (40, -40):
        bar = affinity.rotate(box(-38 * SA, -7 * SA, 38 * SA, 7 * SA), ang, origin=(0, 0))
        emb.append(affinity.translate(bar, *A(cx_, 262)))
        for sgn in (1, -1):
            emb.append(Point(*A(cx_ + sgn * 29 * math.cos(math.radians(ang)) * (1 if True else 1),
                                262 - sgn * 29 * math.sin(math.radians(ang)))).buffer(8 * SA))
emblem = clean(unary_union(emb)).intersection(chief.buffer(-0.3))
st.add(emblem, ZF + 1.0, ZF + 1.4, WHITE)

# ---------- fitas vermelhas
# superior "POLÍCIA CIVIL" (convexa)
rt_m, rt_e = A(512, 40), A(250, 76)
R3 = circle_from(rt_m, rt_e)
c3 = (rt_m[0], rt_m[1] - R3)
w3 = 100 * SA
th3 = math.asin(abs(rt_e[0] - rt_m[0]) / R3)
band3 = arc_band(c3, R3 - w3, R3, th3)
t3L = smooth([(268, 98), (186, 148), (214, 184), (192, 226), (276, 196)], 1)
tails3 = [polyA(t3L), polyA(mirrorA(t3L))]
# inferior "SÃO PAULO" (sorriso)
rb_m, rb_e = A(512, 612), A(150, 556)
R4 = circle_from(rb_m, rb_e)
c4 = (rb_m[0], rb_m[1] + R4)
w4 = 108 * SA
th4 = math.asin(abs(rb_e[0] - rb_m[0]) / R4)
band4 = arc_band(c4, R4, R4 + w4, th4, smile=True)
t4L = smooth([(170, 566), (52, 588), (98, 628), (66, 684), (180, 672)], 1)
tails4 = [polyA(t4L), polyA(mirrorA(t4L))]
for t in tails3 + tails4:
    st.add(t, ZF, ZF + 0.8, RED)
    st.add(outline(t, 0.4), ZF + 0.4, ZF + 0.8, BLACK)
for band in (band3, band4):
    st.add(band, ZF, ZF + 1.2, RED)
    st.add(outline(band, 0.4), ZF + 0.8, ZF + 1.2, BLACK)
capR1 = 2.7
st.add(text_arc("POLÍCIA CIVIL", SANSB, capR1, c3, R3 - w3 / 2 - capR1 / 2, spacing=0.15, fit=(690 - 330) * SA), ZF + 1.2, ZF + 1.6, WHITE)
capR2 = 3.4
st.add(text_arc("SÃO PAULO", SANSB, capR2, c4, R4 + w4 / 2 + capR2 / 2, smile=True, spacing=0.3, fit=(745 - 280) * SA), ZF + 1.2, ZF + 1.6, WHITE)

# ---------- nome e cargo
milena = text_line("MILENA", SERIF, 27.0, width=(1372 - 548) * S, x0=P(548, 0)[0], y0=py1 - 2.5)
st.add(milena, 0, 3.0, BLACK)
st.add(milena, 3.0, 9.4, GOLD, chamfer=1.4)
franc = text_line("FRANCONERE", SERIF, 15.4, width=(1378 - 540) * S, x0=P(540, 0)[0], y0=P(0, 552)[1])
st.add(franc, T, T + 1.8, WHITE, chamfer=0.8)
x_l0, y_l = P(535, 597); x_l1, y_l1 = P(1385, 590)
st.add(box(x_l0, y_l, x_l1, y_l1), T, T + 1.0, GOLD, chamfer=0.4)
escr = text_line("ESCRIVÃ DE POLÍCIA", SANS, 7.0, width=(1345 - 563) * S, x0=P(563, 0)[0], y0=P(0, 668)[1])
st.add(escr, T, T + 0.8, WHITE)

# ================================================================== SÓLIDOS
solids = st.solids()
plaque = {c: to_trimesh(m) for c, m in solids.items()}
for c, m in plaque.items():
    print(f"{COLOR_NAME[c]:9s} watertight={m.is_watertight} vol={m.volume:9.1f} faces={len(m.faces)}")
allb = trimesh.util.concatenate(list(plaque.values())).bounds
print("placa (mm):", np.round(allb, 2).tolist())

# ---------- base (no referencial da placa: topo em y=0, em pé)
BW, BD, BH = 246.0, 50.0, 15.0
bx0 = (allb[0][0] + allb[1][0]) / 2 - BW / 2
zc = 3.0 + 4.0          # a placa fica um pouco atrás do centro da base
def cbox(x0, x1, y0, y1, z0, z1):
    return mf.Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))
ch = 1.5
base_m = mf.Manifold.hull(cbox(bx0, bx0 + BW, -BH, -ch, zc - BD / 2, zc + BD / 2) +
                          cbox(bx0 + ch, bx0 + BW - ch, -BH, 0, zc - BD / 2 + ch, zc + BD / 2 - ch))
slot = cbox(80 - 0.4, px1 - 10 + 0.4, -8.3, 1, -0.2, T + 0.2)
base_m = base_m - slot
base_stand = to_trimesh(base_m)
print("base watertight", base_stand.is_watertight, np.round(base_stand.bounds, 1).tolist())

# ================================================================== EXPORTAÇÃO
os.makedirs(f"{OUT}/stl", exist_ok=True)
for f in os.listdir(f"{OUT}/stl"): os.remove(f"{OUT}/stl/{f}")
for c, m in plaque.items():
    m.export(f"{OUT}/stl/placa_{c}_{COLOR_NAME[c].lower()}.stl")
# base deitada para imprimir: y(placa) -> z(mesa)
Rx = trimesh.transformations.rotation_matrix(math.pi / 2, [1, 0, 0])
base_print = base_stand.copy(); base_print.apply_transform(Rx)
base_print.apply_translation(-base_print.bounds[0])
base_print.export(f"{OUT}/stl/base_preto.stl")

# cena para renderização (em pé, montado)
scene = trimesh.Scene()
pal = {BLACK: [22, 22, 24, 255], GOLD: [232, 166, 48, 255], WHITE: [240, 240, 236, 255], RED: [214, 30, 32, 255]}
for c, m in plaque.items():
    mm = m.copy(); mm.visual.face_colors = pal[c]; scene.add_geometry(mm, node_name=COLOR_NAME[c])
bb = base_stand.copy(); bb.visual.face_colors = [18, 18, 20, 255]; scene.add_geometry(bb, node_name="Base")
scene.export(f"{OUT}/render_scene.glb")

# ---------- 3MF do Bambu Studio (placa multi-peças + base)
plq_off = np.array([128 - (allb[0][0] + allb[1][0]) / 2, 252 - allb[1][1] - 4, 0])
bpb = base_print.bounds
base_off = np.array([128 - (bpb[0][0] + bpb[1][0]) / 2, 8, 0])

def mesh_xml(m, oid):
    v = "".join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in m.vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return f'<object id="{oid}" p:UUID="{uuid.uuid4()}" type="model"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>'

NS = ('xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
      'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
      'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"')
def sub_model(objs):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" {NS}>'
            f'<metadata name="BambuStudio:3mfVersion">1</metadata><resources>{"".join(objs)}</resources><build/></model>')

ident = "1 0 0 0 1 0 0 0 1 0 0 0"
order = [c for c in (BLACK, GOLD, WHITE, RED) if c in plaque]
files = {}
files["3D/Objects/object_1.model"] = sub_model([mesh_xml(plaque[c], i + 1) for i, c in enumerate(order)])
nb = len(order) + 1
files["3D/Objects/object_2.model"] = sub_model([mesh_xml(base_print, nb)])
p_id, b_id = nb + 1, nb + 2
comps = "".join(f'<component p:path="/3D/Objects/object_1.model" objectid="{i + 1}" p:UUID="{uuid.uuid4()}" transform="{ident}"/>' for i in range(len(order)))
files["3D/3dmodel.model"] = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" {NS}>
 <metadata name="Application">BambuStudio-01.10.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Placa Milena Franconere</metadata>
 <resources>
  <object id="{p_id}" p:UUID="{uuid.uuid4()}" type="model"><components>{comps}</components></object>
  <object id="{b_id}" p:UUID="{uuid.uuid4()}" type="model"><components><component p:path="/3D/Objects/object_2.model" objectid="{nb}" p:UUID="{uuid.uuid4()}" transform="{ident}"/></components></object>
 </resources>
 <build p:UUID="{uuid.uuid4()}">
  <item objectid="{p_id}" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 {plq_off[0]:.3f} {plq_off[1]:.3f} 0" printable="1"/>
  <item objectid="{b_id}" p:UUID="{uuid.uuid4()}" transform="1 0 0 0 1 0 0 0 1 {base_off[0]:.3f} {base_off[1]:.3f} 0" printable="1"/>
 </build>
</model>'''
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
pcfg = "".join(f'<part id="{i + 1}" subtype="normal_part"><metadata key="name" value="{COLOR_NAME[c]}"/>'
               f'<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/><metadata key="extruder" value="{c}"/></part>'
               for i, c in enumerate(order))
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
    for k, v in files.items(): z.writestr(k, v)
print("ok")
