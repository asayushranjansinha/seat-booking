"""Hand-derived checks on the oracle. If these fail the fixtures are worthless."""
import math, oracle as o

fails = []
def chk(name, got, want, tol=1e-9):
    ok = abs(got - want) <= tol if isinstance(want, float) else got == want
    print(("  ok  " if ok else "  FAIL") + "  %-46s got=%r want=%r" % (name, got, want))
    if not ok: fails.append(name)

def chkpt(name, got, want, tol=1e-9):
    ok = abs(got[0]-want[0]) <= tol and abs(got[1]-want[1]) <= tol
    print(("  ok  " if ok else "  FAIL") + "  %-46s got=(%.6f,%.6f) want=(%.6f,%.6f)" % (name, got[0],got[1],want[0],want[1]))
    if not ok: fails.append(name)

print("RECT 2x1 tessellation")
r = o.tessellate({"kind":"RECT","w":2,"h":1}, 1e-3)
chk("vertex count", len(r), 4)
chkpt("v0 bottom-left", r[0], (-1.0,-0.5)); chkpt("v2 top-right", r[2], (1.0,0.5))
chk("signed area CCW positive", o.ring_signed_area(r), 2.0)
chk("perimeter", o.ring_perimeter(r), 6.0)
chkpt("centroid", o.ring_centroid(r), (0.0,0.0))

print("\nRECT offset by 0.5 -> 3x2 rect (pure miter, no bevel)")
off = o.offset_ring(r, 0.5)
chk("vertex count unchanged", len(off), 4)
chkpt("off v0", off[0], (-1.5,-1.0)); chkpt("off v2", off[2], (1.5,1.0))
chk("offset perimeter", o.ring_perimeter(off), 10.0)

print("\nsegmentCountForArc determinism")
chk("r=1 tol=1e-3", o.segment_count_for_arc(1.0,1e-3), 72)
chk("r=1 tol=1e-6 clamps to 512", o.segment_count_for_arc(1.0,1e-6), 512)
chk("tiny radius clamps to 12", o.segment_count_for_arc(1e-9,1e-3), 12)
chk("multiple of 4", o.segment_count_for_arc(2.0,1e-3) % 4, 0)

print("\nCIRCLE r=1 tol=1e-3")
c = o.tessellate({"kind":"CIRCLE","r":1}, 1e-3)
chk("n", len(c), 72)
chkpt("v0 on +x axis", c[0], (1.0,0.0))
# The ring is INSCRIBED, so it is strictly inside the true circle. The invariant that
# matters is the sagitta (max deviation from the true arc), which must be <= the
# requested tolerance. Area deficit is the O(1/n^2) consequence of that, not a bug.
chk("sagitta within requested tolerance", 1-math.cos(math.pi/len(c)) <= 1e-3, True)
chk("area is exactly the inscribed n-gon area", o.ring_signed_area(c), 0.5*len(c)*math.sin(2*math.pi/len(c)), 1e-12)
chk("area slightly under pi", o.ring_signed_area(c) < math.pi, True)
chk("perimeter approaches 2pi", o.ring_perimeter(c), 2*math.pi, 5e-3)

print("\npointInRing")
chk("centre inside", o.point_in_ring(r,(0,0)), True)
chk("outside right", o.point_in_ring(r,(5,0)), False)
chk("just inside corner", o.point_in_ring(r,(0.99,0.49)), True)
chk("just outside corner", o.point_in_ring(r,(1.01,0.51)), False)

print("\npointAtArcLength on the 3x2 offset ring (P=10, starts bottom-left going +x)")
chkpt("s=0", o.point_at_arc_length(off,0.0)["point"], (-1.5,-1.0))
chkpt("s=1.25", o.point_at_arc_length(off,1.25)["point"], (-0.25,-1.0))
chkpt("s=3.75 (0.75 up right edge)", o.point_at_arc_length(off,3.75)["point"], (1.5,-0.25))
chkpt("s=10 wraps to 0", o.point_at_arc_length(off,10.0)["point"], (-1.5,-1.0))
chkpt("bottom edge outward normal is -y", o.point_at_arc_length(off,1.0)["outwardNormal"], (0.0,-1.0))

print("\nEDGE_COUNTS rect 2x1 {bottom:3,right:1,top:3,left:1} clearance 0.5")
s = o.place_seats({"shape":{"kind":"RECT","w":2,"h":1},"clearance":0.5,
                   "rule":{"kind":"EDGE_COUNTS","counts":{"bottom":3,"right":1,"top":3,"left":1}},
                   "tolerance":1e-3})
chk("seat count", len(s), 8)
chkpt("seat0 bottom-left-ish", (s[0]["x"],s[0]["y"]), (-2.0/3.0,-1.0))
chkpt("seat1 bottom-centre", (s[1]["x"],s[1]["y"]), (0.0,-1.0))
chkpt("seat3 right-centre",  (s[3]["x"],s[3]["y"]), (1.5,0.0))
chk("seat0 faces +y (toward table)", s[0]["rot"], math.pi/2)
chk("seat3 faces -x (toward table)", abs(s[3]["rot"]), math.pi)

print("\nRADIAL circle r=1 clearance 0.5 count 4")
s = o.place_seats({"shape":{"kind":"CIRCLE","r":1},"clearance":0.5,
                   "rule":{"kind":"RADIAL","count":4}})
chkpt("seat0 +x", (s[0]["x"],s[0]["y"]), (1.5,0.0))
chkpt("seat1 +y", (s[1]["x"],s[1]["y"]), (0.0,1.5))
chk("seat0 faces -x", abs(s[0]["rot"]), math.pi)

print("\nPERIMETER_EVEN rect 2x1 count 8 clearance 0.5 (P=10, spacing 1.25)")
s = o.place_seats({"shape":{"kind":"RECT","w":2,"h":1},"clearance":0.5,
                   "rule":{"kind":"PERIMETER_EVEN","count":8},"tolerance":1e-3})
chkpt("seat0", (s[0]["x"],s[0]["y"]), (-1.5,-1.0))
chkpt("seat1", (s[1]["x"],s[1]["y"]), (-0.25,-1.0))
chkpt("seat2", (s[2]["x"],s[2]["y"]), (1.0,-1.0))
chkpt("seat3", (s[3]["x"],s[3]["y"]), (1.5,-0.25))
# equal spacing is the real invariant
ds = [o.length(o.sub((s[(i+1)%8]["x"],s[(i+1)%8]["y"]),(s[i]["x"],s[i]["y"]))) for i in range(8)]
print("    consecutive gaps:", [round(d,6) for d in ds])

print("\nHEADLINE: resize 2x1 -> 3x1.5 redistributes proportionally")
def arclens(w,h,count=8):
    ring = o.tessellate({"kind":"RECT","w":w,"h":h},1e-3)
    off = o.offset_ring(ring,0.5)
    P = o.ring_perimeter(off)
    sp = o.place_seats({"shape":{"kind":"RECT","w":w,"h":h},"clearance":0.5,
                        "rule":{"kind":"PERIMETER_EVEN","count":count},"tolerance":1e-3})
    return P, [o.project_to_arc_length(off,(x["x"],x["y"]))/P for x in sp]
P1,f1 = arclens(2,1); P2,f2 = arclens(3,1.5)
chk("P small", P1, 10.0); chk("P large", P2, 13.0)
print("    normalised arc positions small:", [round(v,6) for v in f1])
print("    normalised arc positions large:", [round(v,6) for v in f2])
chk("same fractional positions", max(abs(a-b) for a,b in zip(f1,f2)) < 1e-9, True)

print("\nHEADLINE: rotate the table, seats follow via transform composition")
tbl = {"x":5.0,"y":2.0,"rot":0.0}
seat_local = (1.5,0.0)
chkpt("world before rotation", o.apply_transform(tbl,seat_local), (6.5,2.0))
tbl_rot = {"x":5.0,"y":2.0,"rot":math.pi/2}
chkpt("world after 90deg",     o.apply_transform(tbl_rot,seat_local), (5.0,3.5))
inv = o.invert_transform(tbl_rot)
chkpt("invert round-trips", o.apply_transform(inv,o.apply_transform(tbl_rot,seat_local)), seat_local)

print("\nHEADLINE: drag one seat -> it pins, the rest redistribute around it")
s = o.place_seats({"shape":{"kind":"RECT","w":2,"h":1},"clearance":0.5,
                   "rule":{"kind":"PERIMETER_EVEN","count":8},"tolerance":1e-3,
                   "overrides":[{"index":2,"x":1.5,"y":1.0,"rot":0.0}]})
chk("still 8 seats", len(s), 8)
chk("seat2 pinned exactly where dropped", (s[2]["x"],s[2]["y"]) == (1.5,1.0), True)
chk("seat2 marked override", s[2]["override"], True)
chk("others not overridden", sum(1 for x in s if x["override"]), 1)
off2 = o.offset_ring(o.tessellate({"kind":"RECT","w":2,"h":1},1e-3),0.5)
sl = sorted(o.project_to_arc_length(off2,(x["x"],x["y"])) for x in s)
gaps = [round((sl[(i+1)%8]-sl[i]) % 10.0, 6) for i in range(8)]
print("    arc gaps between all 8 seats:", gaps)
chk("7 free seats evenly fill the ring around the pin", len(set(gaps)) <= 2, True)

print("\n" + ("ALL ORACLE CHECKS PASSED" if not fails else "FAILURES: %r" % fails))
