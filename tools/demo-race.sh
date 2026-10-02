#!/usr/bin/env bash
# Fire 16 simultaneous booking requests at ONE seat for the SAME slot.
#
# Exactly one is accepted and fifteen are refused, every time. The database decides it:
# both requests genuinely reach Postgres and an exclusion constraint admits one. Remove
# that constraint and all sixteen succeed, booking the seat sixteen times over.
set -uo pipefail
cd "$(dirname "$0")/.."

API=http://localhost:8080
SEAT_CODE=${1:-C3}

token() {
  curl -s -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
    -d '{"email":"user@demo.test","password":"password"}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])'
}

TOKEN=$(token)
if [ -z "$TOKEN" ]; then echo "Could not sign in. Is the API running on :8080?"; exit 1; fi

SEAT=$(docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -tAc \
  "SELECT s.id FROM seat s JOIN floor_plan_version v ON v.id = s.plan_version_id
   WHERE v.status='PUBLISHED' AND s.code='$SEAT_CODE' LIMIT 1" | tr -d '[:space:]')
if [ -z "$SEAT" ]; then echo "No published seat called $SEAT_CODE"; exit 1; fi

# A slot far enough ahead that it is inside the 6-day window and almost certainly free.
START=$(python3 -c "
from datetime import datetime, timedelta, timezone
t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(days=5)
print(t.isoformat().replace('+00:00','Z'))")
END=$(python3 -c "
from datetime import datetime, timedelta, timezone
t = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(days=5, hours=2)
print(t.isoformat().replace('+00:00','Z'))")

# Clear the slot so the demo starts from a free seat.
docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -q \
  -c "DELETE FROM booking WHERE seat_id = '$SEAT'" >/dev/null

echo "Firing 16 simultaneous requests at seat $SEAT_CODE for $START"
echo

OUT=$(mktemp -d)
for i in $(seq 1 16); do
  (
    curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/bookings" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
      -d "{\"seatId\":\"$SEAT\",\"startsAt\":\"$START\",\"endsAt\":\"$END\"}" > "$OUT/$i"
  ) &
done
wait

CREATED=$(grep -l '^201$' "$OUT"/* 2>/dev/null | wc -l | tr -d ' ')
CONFLICT=$(grep -l '^409$' "$OUT"/* 2>/dev/null | wc -l | tr -d ' ')
OTHER=$(( 16 - CREATED - CONFLICT ))
rm -rf "$OUT"

echo "  accepted (201): $CREATED"
echo "  refused  (409): $CONFLICT"
echo "  anything else : $OTHER"
echo
LIVE=$(docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -tAc \
  "SELECT count(*) FROM booking WHERE seat_id='$SEAT' AND status<>'CANCELLED'" | tr -d '[:space:]')
echo "  bookings now held on that seat: $LIVE"

if [ "$CREATED" = "1" ] && [ "$OTHER" = "0" ] && [ "$LIVE" = "1" ]; then
  echo
  echo "Exactly one won. That is the exclusion constraint, not application code."
else
  echo
  echo "Unexpected result — something is wrong, do not hand-wave this in a demo."
  exit 1
fi
