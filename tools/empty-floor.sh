#!/usr/bin/env bash
# Strip the demo layout, keeping only who can sign in and where they can draw.
#
# Kept:    the organisation, the three users, the building and its floor.
# Removed: every plan version and everything hanging off one — rooms, tables, seats,
#          doors, partitions — plus all bookings, meetings, invitations and queued mail.
#
# The building and floor stay because there is currently no way to create either from the
# UI. Delete them and you cannot draw anything at all.
set -euo pipefail
cd "$(dirname "$0")/.."

# -i is required: without it docker exec does not forward stdin and psql silently runs
# nothing, reporting success while deleting not a single row.
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -q -v ON_ERROR_STOP=1 <<'SQL'
SET client_min_messages TO warning;

-- Order matters: bookings reference seats with ON DELETE RESTRICT, which is deliberate
-- (editing a layout must never silently destroy someone's booking), so they go first.
DELETE FROM email_outbox;
DELETE FROM meeting_invite;
DELETE FROM booking;
DELETE FROM meeting;

-- Deleting the plan versions cascades to rooms, and rooms cascade to partitions, gates,
-- furniture and seats.
DELETE FROM floor_plan_version;
SQL

echo "Layout cleared. What is left:"
docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -q -c "
SELECT
  (SELECT count(*) FROM organization)       AS orgs,
  (SELECT count(*) FROM app_user)           AS users,
  (SELECT count(*) FROM building)           AS buildings,
  (SELECT count(*) FROM floor)              AS floors,
  (SELECT count(*) FROM floor_plan_version) AS plans,
  (SELECT count(*) FROM room)               AS rooms,
  (SELECT count(*) FROM seat)               AS seats,
  (SELECT count(*) FROM booking)            AS bookings;"

echo "Sign in at http://localhost:3000"
docker exec seatbooking-postgres psql -U seatbooking -d seatbooking -tAF'  ' -c \
  "SELECT '  ' || email || '  (' || role || ')' FROM app_user ORDER BY role;"
echo "  password for all three: password"
