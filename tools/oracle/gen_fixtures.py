"""Generate the golden fixtures from the oracle. Run via `npm run fixtures:gen`."""
import json, math, os
import oracle as o

OUT = os.path.join(os.path.dirname(__file__), "..", "..",
                   "packages", "geometry-fixtures", "fixtures")
OUT = os.path.normpath(OUT)
TOL = 1e-3   # tessellation tolerance used throughout the fixtures (1 mm)

RECT_2x1   = {"kind": "RECT", "w": 2.0, "h": 1.0}
RECT_3x15  = {"kind": "RECT", "w": 3.0, "h": 1.5}
RECT_1x1   = {"kind": "RECT", "w": 1.0, "h": 1.0}
CIRCLE_075 = {"kind": "CIRCLE", "r": 0.75}
ELLIPSE    = {"kind": "ELLIPSE", "rx": 1.2, "ry": 0.8}
TRIANGLE   = {"kind": "POLYGON", "points": [[-1.0, -0.6], [1.0, -0.6], [0.0, 0.9]]}
L_SHAPE    = {"kind": "POLYGON", "points": [[-1.0, -1.0], [1.0, -1.0], [1.0, 0.0],
                                            [0.0, 0.0], [0.0, 1.0], [-1.0, 1.0]]}
CW_SQUARE  = {"kind": "POLYGON", "points": [[-1.0, -1.0], [-1.0, 1.0],
                                            [1.0, 1.0], [1.0, -1.0]]}   # wound CW on purpose
SPIKE      = {"kind": "POLYGON", "points": [[-1.0, 0.0], [1.0, 0.0], [0.0, 0.08]]}  # bevels

def ring_json(ring):
    return [[p[0], p[1]] for p in ring]

def write(name, fn, cases, note=None):
    doc = {"fn": fn, "generatedBy": "tools/oracle/oracle.py", "tessellationTolerance": TOL,
           "compareTolerance": 1e-6, "cases": cases}
    if note:
        doc["note"] = note
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("  %-22s %3d cases" % (name, len(cases)))

os.makedirs(OUT, exist_ok=True)
print("writing fixtures to", OUT)

# -- segment-count ----------------------------------------------------------
cases = []
for r, t in [(1.0, 1e-3), (0.75, 1e-3), (2.0, 1e-3), (10.0, 1e-3),
             (1.0, 1e-2), (1.0, 1e-4), (1.0, 1e-6), (1e-9, 1e-3), (0.05, 1e-3)]:
    cases.append({"name": "r=%g tol=%g" % (r, t),
                  "input": {"radius": r, "tolerance": t},
                  "expected": {"n": o.segment_count_for_arc(r, t)}})
write("segment-count.json", "segmentCountForArc", cases,
      "Integer output: must match EXACTLY, not within tolerance.")

# -- tessellate -------------------------------------------------------------
cases = []
for nm, sh in [("rect 2x1", RECT_2x1), ("rect 1x1", RECT_1x1), ("circle r=0.75", CIRCLE_075),
               ("ellipse 1.2x0.8", ELLIPSE), ("triangle", TRIANGLE), ("L-shape", L_SHAPE),
               ("square wound CW is rewound CCW", CW_SQUARE)]:
    cases.append({"name": nm, "input": {"shape": sh, "tolerance": TOL},
                  "expected": {"ring": ring_json(o.tessellate(sh, TOL))}})
write("tessellate.json", "tessellate", cases)

# -- transform --------------------------------------------------------------
cases = []
tf = lambda x, y, r: {"x": x, "y": y, "rot": r}
for nm, parent, child in [
    ("identity compose", tf(0, 0, 0), tf(1, 2, 0.3)),
    ("translate only",   tf(5, 2, 0), tf(1.5, 0, 0)),
    ("rotate 90",        tf(5, 2, math.pi / 2), tf(1.5, 0, 0)),
    ("rotate 45 + offset", tf(-3, 1.25, math.pi / 4), tf(2, -1, math.pi / 6)),
]:
    cases.append({"name": "compose: " + nm, "op": "compose",
                  "input": {"parent": parent, "child": child},
                  "expected": o.compose_transform(parent, child)})
for nm, t, p in [("identity", tf(0, 0, 0), (1.5, 0.0)),
                 ("translate", tf(5, 2, 0), (1.5, 0.0)),
                 ("rotate 90", tf(5, 2, math.pi / 2), (1.5, 0.0)),
                 ("rotate 180", tf(0, 0, math.pi), (1.0, 2.0))]:
    pt = o.apply_transform(t, p)
    cases.append({"name": "apply: " + nm, "op": "apply",
                  "input": {"transform": t, "point": [p[0], p[1]]},
                  "expected": {"point": [pt[0], pt[1]]}})
for nm, t in [("rotate 90 at offset", tf(5, 2, math.pi / 2)),
              ("rotate -30", tf(1, -1, -math.pi / 6))]:
    cases.append({"name": "invert: " + nm, "op": "invert",
                  "input": {"transform": t},
                  "expected": o.invert_transform(t)})
write("transform.json", "transform", cases)

# -- ring metrics -----------------------------------------------------------
cases = []
for nm, sh in [("rect 2x1", RECT_2x1), ("triangle", TRIANGLE), ("L-shape", L_SHAPE),
               ("circle r=0.75", CIRCLE_075), ("ellipse", ELLIPSE)]:
    ring = o.tessellate(sh, TOL)
    c = o.ring_centroid(ring)
    cases.append({"name": nm, "input": {"ring": ring_json(ring)},
                  "expected": {"area": o.ring_signed_area(ring),
                               "perimeter": o.ring_perimeter(ring),
                               "centroid": [c[0], c[1]]}})
write("ring-metrics.json", "ringMetrics", cases)

cases = []
ring = o.tessellate(L_SHAPE, TOL)
for nm, p in [("centre of lower arm", (-0.5, -0.5)), ("inside upper arm", (-0.5, 0.5)),
              ("in the notch (outside)", (0.5, 0.5)), ("far outside", (5.0, 5.0)),
              ("inside near edge", (0.95, -0.95))]:
    cases.append({"name": "L-shape: " + nm,
                  "input": {"ring": ring_json(ring), "point": [p[0], p[1]]},
                  "expected": {"inside": o.point_in_ring(ring, p)}})
write("point-in-ring.json", "pointInRing", cases)

# -- arc length -------------------------------------------------------------
cases = []
off = o.offset_ring(o.tessellate(RECT_2x1, TOL), 0.5)
for s in [0.0, 1.25, 2.5, 3.75, 5.0, 7.5, 9.99, 10.0, 12.5, -1.25]:
    r = o.point_at_arc_length(off, s)
    cases.append({"name": "offset rect 3x2 (P=10) at s=%g" % s,
                  "input": {"ring": ring_json(off), "s": s},
                  "expected": {"point": [r["point"][0], r["point"][1]],
                               "tangent": [r["tangent"][0], r["tangent"][1]],
                               "outwardNormal": [r["outwardNormal"][0], r["outwardNormal"][1]]}})
write("arc-length.json", "pointAtArcLength", cases,
      "s wraps modulo perimeter, including negative s.")

# -- offset ring ------------------------------------------------------------
cases = []
for nm, sh, d in [("rect 2x1 by 0.5 (pure miter)", RECT_2x1, 0.5),
                  ("rect 2x1 by 0.0 (identity)", RECT_2x1, 0.0),
                  ("triangle by 0.3", TRIANGLE, 0.3),
                  ("L-shape by 0.25 (has a reflex corner)", L_SHAPE, 0.25),
                  ("thin spike by 0.2 (exceeds miter limit -> bevels)", SPIKE, 0.2),
                  ("circle r=0.75 by 0.4", CIRCLE_075, 0.4)]:
    ring = o.tessellate(sh, TOL)
    cases.append({"name": nm, "input": {"ring": ring_json(ring), "distance": d},
                  "expected": {"ring": ring_json(o.offset_ring(ring, d))}})
write("offset-ring.json", "offsetRing", cases,
      "Miter joins, limit 4, bevelling past it. Hand-rolled identically in both "
      "languages rather than delegated to clipper2-js / JTS buffer(), which are not "
      "guaranteed to agree vertex-for-vertex.")

# -- place seats ------------------------------------------------------------
def seats_json(req):
    return {"seats": [{"index": s["index"], "x": s["x"], "y": s["y"],
                       "rot": s["rot"], "override": s["override"]}
                      for s in o.place_seats(req)]}

cases = []
reqs = [
    ("PERIMETER_EVEN rect 2x1 n=8", {"shape": RECT_2x1, "clearance": 0.5,
        "rule": {"kind": "PERIMETER_EVEN", "count": 8}, "tolerance": TOL}),
    ("PERIMETER_EVEN rect 2x1 n=6 startOffset 0.5", {"shape": RECT_2x1, "clearance": 0.5,
        "rule": {"kind": "PERIMETER_EVEN", "count": 6, "startOffset": 0.5}, "tolerance": TOL}),
    ("PERIMETER_EVEN circle r=0.75 n=5", {"shape": CIRCLE_075, "clearance": 0.4,
        "rule": {"kind": "PERIMETER_EVEN", "count": 5}, "tolerance": TOL}),
    ("PERIMETER_EVEN L-shape n=10", {"shape": L_SHAPE, "clearance": 0.3,
        "rule": {"kind": "PERIMETER_EVEN", "count": 10}, "tolerance": TOL}),
    ("EDGE_COUNTS rect named sides", {"shape": RECT_2x1, "clearance": 0.5,
        "rule": {"kind": "EDGE_COUNTS",
                 "counts": {"top": 3, "bottom": 3, "left": 1, "right": 1}}, "tolerance": TOL}),
    ("EDGE_COUNTS triangle numeric indices", {"shape": TRIANGLE, "clearance": 0.3,
        "rule": {"kind": "EDGE_COUNTS", "counts": {"0": 2, "1": 1, "2": 1}}, "tolerance": TOL}),
    ("RADIAL circle n=6", {"shape": CIRCLE_075, "clearance": 0.4,
        "rule": {"kind": "RADIAL", "count": 6}, "tolerance": TOL}),
    ("RADIAL ellipse n=8 startAngle pi/8", {"shape": ELLIPSE, "clearance": 0.35,
        "rule": {"kind": "RADIAL", "count": 8, "startAngle": math.pi / 8}, "tolerance": TOL}),
    ("MANUAL three seats", {"shape": RECT_2x1, "clearance": 0.5,
        "rule": {"kind": "MANUAL"}, "tolerance": TOL,
        "overrides": [{"index": 0, "x": 0.0, "y": -1.0, "rot": 1.5707963267948966},
                      {"index": 1, "x": 1.5, "y": 0.0, "rot": 3.141592653589793},
                      {"index": 2, "x": 0.0, "y": 1.0, "rot": -1.5707963267948966}]}),
]
for nm, req in reqs:
    cases.append({"name": nm, "input": req, "expected": seats_json(req)})
write("place-seats.json", "placeSeats", cases)

# -- headline ---------------------------------------------------------------
cases = []
head = [
    ("resize: rect 2x1 n=8 (offset perimeter 10)", {"shape": RECT_2x1, "clearance": 0.5,
        "rule": {"kind": "PERIMETER_EVEN", "count": 8}, "tolerance": TOL}),
    ("resize: rect 3x1.5 n=8 (offset perimeter 13) - same fractional positions",
        {"shape": RECT_3x15, "clearance": 0.5,
         "rule": {"kind": "PERIMETER_EVEN", "count": 8}, "tolerance": TOL}),
    ("override: seat 2 dragged to the top-right corner, other 7 redistribute",
        {"shape": RECT_2x1, "clearance": 0.5,
         "rule": {"kind": "PERIMETER_EVEN", "count": 8}, "tolerance": TOL,
         "overrides": [{"index": 2, "x": 1.5, "y": 1.0, "rot": 0.0}]}),
    ("override: two pinned seats, remaining 6 split proportionally between the gaps",
        {"shape": RECT_2x1, "clearance": 0.5,
         "rule": {"kind": "PERIMETER_EVEN", "count": 8}, "tolerance": TOL,
         "overrides": [{"index": 0, "x": -1.5, "y": -1.0, "rot": 0.0},
                       {"index": 4, "x": 1.5, "y": 1.0, "rot": 0.0}]}),
]
for nm, req in head:
    cases.append({"name": nm, "input": req, "expected": seats_json(req)})
write("headline.json", "placeSeats", cases,
      "The product requirement: place a seat at an angle and the nearby seats move in "
      "the same proportion. Resize cases must share identical normalised arc positions.")
print("done")
