"""
Independent reference implementation of the seat-booking geometry engine.

This is the ORACLE. It exists to generate the golden fixtures that the shipped
TypeScript and Java implementations are tested against. It is written from the
formulas in packages/geometry-fixtures/README.md, deliberately in a third language,
so that a fixture can actually catch a bug in the code under test rather than
simply blessing whichever implementation happened to be written first.

Not shipped. Not imported by anything. Run via `npm run fixtures:gen`.
"""

import json
import math
import os

TAU = 2.0 * math.pi
MITER_LIMIT = 4.0

# ---------------------------------------------------------------- vec helpers

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])

def add(a, b):
    return (a[0] + b[0], a[1] + b[1])

def scale(a, k):
    return (a[0] * k, a[1] * k)

def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]

def length(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1])

def normalize(a):
    L = length(a)
    if L == 0.0:
        return (0.0, 0.0)
    return (a[0] / L, a[1] / L)

def outward_normal(d):
    """Outward normal of a directed edge on a CCW ring: interior is to the left."""
    u = normalize(d)
    return (u[1], -u[0])

# ------------------------------------------------------- deterministic counts

def segment_count_for_arc(r, tol):
    """Integer segment count. Uses only * / and sqrt, which IEEE-754 requires to be
    correctly rounded, so JS and Java cannot disagree. See README 'Determinism'."""
    n = math.ceil(math.pi * math.sqrt(r / (2.0 * tol)))
    n = 4 * ((n + 3) // 4)
    if n < 12:
        n = 12
    if n > 512:
        n = 512
    return n

# ----------------------------------------------------------------- tessellate

def ring_signed_area(ring):
    s = 0.0
    n = len(ring)
    for i in range(n):
        p = ring[i]
        q = ring[(i + 1) % n]
        s += p[0] * q[1] - q[0] * p[1]
    return 0.5 * s

def tessellate(shape, tol):
    kind = shape["kind"]
    if kind == "RECT":
        w = shape["w"] / 2.0
        h = shape["h"] / 2.0
        return [(-w, -h), (w, -h), (w, h), (-w, h)]
    if kind == "CIRCLE":
        r = shape["r"]
        n = segment_count_for_arc(r, tol)
        return [(r * math.cos(TAU * i / n), r * math.sin(TAU * i / n)) for i in range(n)]
    if kind == "ELLIPSE":
        rx, ry = shape["rx"], shape["ry"]
        n = segment_count_for_arc(max(rx, ry), tol)
        return [(rx * math.cos(TAU * i / n), ry * math.sin(TAU * i / n)) for i in range(n)]
    if kind == "POLYGON":
        pts = [(p[0], p[1]) for p in shape["points"]]
        if ring_signed_area(pts) < 0.0:
            pts.reverse()
        return pts
    raise ValueError("unsupported shape kind: " + kind)

# -------------------------------------------------------------- ring measures

def ring_perimeter(ring):
    n = len(ring)
    return sum(length(sub(ring[(i + 1) % n], ring[i])) for i in range(n))

def ring_centroid(ring):
    a = ring_signed_area(ring)
    n = len(ring)
    if abs(a) < 1e-12:
        return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    cx = cy = 0.0
    for i in range(n):
        p = ring[i]
        q = ring[(i + 1) % n]
        cross = p[0] * q[1] - q[0] * p[1]
        cx += (p[0] + q[0]) * cross
        cy += (p[1] + q[1]) * cross
    return (cx / (6.0 * a), cy / (6.0 * a))

def point_in_ring(ring, pt):
    """Ray casting. Boundary cases are not specified and not fixtured."""
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[(i + 1) % n]
        if (yi > y) != (yj > y):
            xcross = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < xcross:
                inside = not inside
    return inside

# ------------------------------------------------------------------ arclength

def point_at_arc_length(ring, s):
    n = len(ring)
    P = ring_perimeter(ring)
    s = math.fmod(s, P)
    if s < 0.0:
        s += P
    acc = 0.0
    for i in range(n):
        p = ring[i]
        q = ring[(i + 1) % n]
        d = sub(q, p)
        L = length(d)
        if acc + L >= s or i == n - 1:
            t = 0.0 if L == 0.0 else (s - acc) / L
            u = normalize(d)
            return {
                "point": add(p, scale(d, t)),
                "tangent": u,
                "outwardNormal": (u[1], -u[0]),
            }
        acc += L
    raise AssertionError("unreachable")

def project_to_arc_length(ring, pt):
    """Arc length of the closest point on the ring. Ties break to the lower edge index."""
    n = len(ring)
    best_d2 = float("inf")
    best_s = 0.0
    acc = 0.0
    for i in range(n):
        p = ring[i]
        q = ring[(i + 1) % n]
        d = sub(q, p)
        L = length(d)
        if L == 0.0:
            acc += L
            continue
        t = dot(sub(pt, p), d) / (L * L)
        t = max(0.0, min(1.0, t))
        c = add(p, scale(d, t))
        diff = sub(pt, c)
        d2 = dot(diff, diff)
        if d2 < best_d2:
            best_d2 = d2
            best_s = acc + t * L
        acc += L
    return best_s

# ----------------------------------------------------------------- offsetting

def offset_ring(ring, dist):
    """Outward offset with miter joins, bevelling past MITER_LIMIT."""
    n = len(ring)
    out = []
    for i in range(n):
        prev = ring[(i - 1) % n]
        cur = ring[i]
        nxt = ring[(i + 1) % n]
        n0 = outward_normal(sub(cur, prev))
        n1 = outward_normal(sub(nxt, cur))
        m = add(n0, n1)
        mlen = length(m)
        if mlen < 1e-12:
            out.append(add(cur, scale(n0, dist)))
            out.append(add(cur, scale(n1, dist)))
            continue
        m = scale(m, 1.0 / mlen)
        cos_half = dot(m, n0)
        if cos_half <= 1.0 / MITER_LIMIT:
            out.append(add(cur, scale(n0, dist)))
            out.append(add(cur, scale(n1, dist)))
        else:
            out.append(add(cur, scale(m, dist / cos_half)))
    return out

# ------------------------------------------------------------------ transform

def compose_transform(parent, child):
    c = math.cos(parent["rot"])
    s = math.sin(parent["rot"])
    return {
        "x": parent["x"] + c * child["x"] - s * child["y"],
        "y": parent["y"] + s * child["x"] + c * child["y"],
        "rot": parent["rot"] + child["rot"],
    }

def apply_transform(t, p):
    c = math.cos(t["rot"])
    s = math.sin(t["rot"])
    return (t["x"] + c * p[0] - s * p[1], t["y"] + s * p[0] + c * p[1])

def invert_transform(t):
    c = math.cos(-t["rot"])
    s = math.sin(-t["rot"])
    return {
        "x": -(c * t["x"] - s * t["y"]),
        "y": -(s * t["x"] + c * t["y"]),
        "rot": -t["rot"],
    }

# -------------------------------------------------------------------- seating

RECT_EDGE_NAMES = {"bottom": 0, "right": 1, "top": 2, "left": 3}

def _allocate(m, lengths, total):
    """Largest-remainder allocation of m items across gaps, ties to lower index."""
    k = len(lengths)
    if k == 0:
        return []
    quotas = [m * L / total for L in lengths]
    base = [int(math.floor(q)) for q in quotas]
    left = m - sum(base)
    order = sorted(range(k), key=lambda j: (-(quotas[j] - base[j]), j))
    for j in range(left):
        base[order[j]] += 1
    return base

def _facing(outward):
    return math.atan2(-outward[1], -outward[0])

def place_seats(req):
    shape = req["shape"]
    clearance = req["clearance"]
    rule = req["rule"]
    tol = req.get("tolerance", 1e-6)
    overrides = {o["index"]: o for o in req.get("overrides", [])}
    kind = rule["kind"]

    if kind == "MANUAL":
        return [
            {"index": i, "x": overrides[i]["x"], "y": overrides[i]["y"],
             "rot": overrides[i]["rot"], "override": True}
            for i in sorted(overrides)
        ]

    if kind == "RADIAL":
        if shape["kind"] == "CIRCLE":
            rx = ry = shape["r"]
        elif shape["kind"] == "ELLIPSE":
            rx, ry = shape["rx"], shape["ry"]
        else:
            raise ValueError("RADIAL requires CIRCLE or ELLIPSE")
        count = rule["count"]
        start = rule.get("startAngle", 0.0)
        out = []
        for i in range(count):
            if i in overrides:
                o = overrides[i]
                out.append({"index": i, "x": o["x"], "y": o["y"], "rot": o["rot"],
                            "override": True})
                continue
            t = start + TAU * i / count
            p = ((rx + clearance) * math.cos(t), (ry + clearance) * math.sin(t))
            out.append({"index": i, "x": p[0], "y": p[1],
                        "rot": _facing(normalize(p)), "override": False})
        return out

    ring = tessellate(shape, tol)

    if kind == "EDGE_COUNTS":
        raw = rule["counts"]
        counts = {}
        for key, v in raw.items():
            idx = RECT_EDGE_NAMES[key] if key in RECT_EDGE_NAMES else int(key)
            counts[idx] = v
        out = []
        idx = 0
        n = len(ring)
        for e in sorted(counts):
            m = counts[e]
            p = ring[e]
            q = ring[(e + 1) % n]
            d = sub(q, p)
            nrm = outward_normal(d)
            for j in range(m):
                if idx in overrides:
                    o = overrides[idx]
                    out.append({"index": idx, "x": o["x"], "y": o["y"], "rot": o["rot"],
                                "override": True})
                else:
                    t = (j + 0.5) / m
                    c = add(add(p, scale(d, t)), scale(nrm, clearance))
                    out.append({"index": idx, "x": c[0], "y": c[1],
                                "rot": _facing(nrm), "override": False})
                idx += 1
        return out

    if kind == "PERIMETER_EVEN":
        count = rule["count"]
        start_offset = rule.get("startOffset", 0.0)
        off = offset_ring(ring, clearance)
        P = ring_perimeter(off)
        free = [i for i in range(count) if i not in overrides]

        if not overrides:
            slots = [P * (i + start_offset) / count for i in range(count)]
        else:
            pinned = sorted(
                (project_to_arc_length(off, (overrides[i]["x"], overrides[i]["y"])), i)
                for i in overrides
            )
            k = len(pinned)
            if k == 1:
                gaps = [(pinned[0][0], P)]
            else:
                gaps = []
                for j in range(k):
                    s0 = pinned[j][0]
                    s1 = pinned[(j + 1) % k][0]
                    L = math.fmod(s1 - s0, P)
                    if L < 0.0:
                        L += P
                    gaps.append((s0, L))
            alloc = _allocate(len(free), [g[1] for g in gaps], P)
            slots = []
            for (s0, L), m in zip(gaps, alloc):
                for j in range(m):
                    slots.append(math.fmod(s0 + L * (j + 1) / (m + 1), P))
            # Assign free seats to slots in ascending arc length, not in gap order, so a
            # seat keeps roughly the position it already had. Without this, pinning one
            # seat makes every other seat's identity jump around the table.
            slots.sort()

        out = [None] * count
        for i in overrides:
            o = overrides[i]
            out[i] = {"index": i, "x": o["x"], "y": o["y"], "rot": o["rot"],
                      "override": True}
        for slot_i, i in enumerate(free):
            r = point_at_arc_length(off, slots[slot_i])
            out[i] = {"index": i, "x": r["point"][0], "y": r["point"][1],
                      "rot": _facing(r["outwardNormal"]), "override": False}
        return out

    raise ValueError("unsupported rule: " + kind)
