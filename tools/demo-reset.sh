#!/usr/bin/env bash
# Put the demo back to a known state: three rooms, four tables, 27 seats, no bookings,
# empty mailbox. Takes about 25 seconds, almost all of it the API restarting.
#
# Never demo from a draft you have been poking at. Run this first.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Stopping the API..."
lsof -ti:8080 | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "Wiping the database..."
# client_min_messages=warning drops the "drop cascades to..." notices, which are a wall
# of text in front of a client and say nothing useful.
docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -q \
  -v ON_ERROR_STOP=1 \
  -c "SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO seatbooking;" >/dev/null 2>&1

echo "Emptying the mailbox..."
curl -s -X DELETE http://localhost:8025/api/v1/messages >/dev/null 2>&1 || true

echo "Restarting the API (it re-seeds on boot)..."
( cd apps/api && mvn -B spring-boot:run > /tmp/api.log 2>&1 & )

printf "Waiting for the demo floor"
for _ in $(seq 1 60); do
  if grep -q "Demo floor published" /tmp/api.log 2>/dev/null; then
    echo
    grep "Demo floor published" /tmp/api.log | tail -1
    echo
    echo "Ready. Reload http://localhost:3000 and sign in as admin@demo.test / password"
    exit 0
  fi
  printf "."
  sleep 1
done

echo
echo "The API did not finish starting. Last lines of /tmp/api.log:"
tail -15 /tmp/api.log
exit 1
