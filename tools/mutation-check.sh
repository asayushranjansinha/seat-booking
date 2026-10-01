#!/usr/bin/env bash
# Verifies the cross-language fixture harness can actually FAIL.
#
# Two implementations of the same maths are only kept honest by fixtures that notice when
# they drift. A suite that passes no matter what you break proves nothing, so this script
# deliberately breaks the Java engine in ways the TypeScript engine would not share, and
# asserts that the suite goes red each time.
#
# It found a real gap on first run: changing MITER_LIMIT from 4 to 3 passed every test,
# because no fixture had a corner angle in the 28.96-38.94 degree band where the two
# limits disagree. The wedge fixtures exist because of that.
set -uo pipefail
cd "$(dirname "$0")/.."
API=apps/api/src/main/java/com/seatbooking/geometry
pass=0; fail=0

mutate() {
  local name="$1" file="$2" from="$3" to="$4"
  cp "$API/$file" "/tmp/mutcheck.bak"
  sed -i '' "s|$from|$to|" "$API/$file"
  if (cd apps/api && mvn -B -q test >/dev/null 2>&1); then
    echo "  NOT CAUGHT  $name"
    fail=$((fail+1))
  else
    echo "  caught      $name"
    pass=$((pass+1))
  fi
  cp "/tmp/mutcheck.bak" "$API/$file"
}

echo "mutating the Java geometry engine; every mutant must turn the suite red"
mutate "segment count rounds to a multiple of 2, not 4" Tessellation.java \
  'n = 4 \* ((n + 3) / 4);' 'n = 2 * ((n + 1) / 2);'
mutate "segment count clamp raised from 512 to 600" Tessellation.java \
  'return 512;' 'return 600;'
mutate "miter limit 4 -> 3" Offsets.java \
  'MITER_LIMIT = 4;' 'MITER_LIMIT = 3;'
mutate "outward normal flipped" Vec2.java \
  'return new Vec2(u.y, -u.x);' 'return new Vec2(-u.y, u.x);'
mutate "rect tessellated clockwise" Tessellation.java \
  'new Vec2(-w, -h), new Vec2(w, -h), new Vec2(w, h), new Vec2(-w, h));' \
  'new Vec2(-w, h), new Vec2(w, h), new Vec2(w, -h), new Vec2(-w, -h));'

echo
echo "caught $pass / $((pass+fail))"
if [ "$fail" -ne 0 ]; then
  echo "A mutant survived: the fixtures do not pin that behaviour. Add a case that does."
  exit 1
fi
