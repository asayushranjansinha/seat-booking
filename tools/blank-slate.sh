#!/usr/bin/env bash
# Empty the product of everything except who can sign in.
#
# Kept:    the organisation, and the three user accounts with their passwords.
# Removed: buildings, floors, every plan version and all that hangs off one (rooms,
#          tables, seats, doors, partitions), bookings, meetings, invitations, queued
#          mail, and every refresh token.
#
# The organisation row STAYS, and not for tidiness: DemoDataSeeder re-seeds the whole
# demo on boot whenever it finds no organisation. Delete it and the next API restart
# silently puts the demo floor back, which looks exactly like the wipe having failed.
#
# Refresh tokens go because they are session state, not credentials. Anyone already
# signed in is signed out, which is what you want before a demo rather than a stale tab
# holding a token for data that no longer exists.
#
# Unlike tools/demo-reset.sh this needs no restart: it deletes rows, it does not drop
# the schema, so Flyway has nothing to re-run and the seeder has nothing to do.
set -euo pipefail
cd "$(dirname "$0")/.."

# -i is required: without it docker exec does not forward stdin and psql silently runs
# nothing, reporting success while deleting not a single row.
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -q -v ON_ERROR_STOP=1 <<'SQL'
SET client_min_messages TO warning;

BEGIN;

-- Order matters. booking.seat_id is ON DELETE RESTRICT on purpose — editing a layout
-- must never quietly destroy someone's booking — so bookings go before the seats they
-- point at, and the database refuses the whole transaction if anything is missed.
DELETE FROM email_outbox;
DELETE FROM meeting_invite;
DELETE FROM booking;
DELETE FROM meeting;

-- Plan versions cascade to rooms, and rooms cascade to partitions, gates, furniture and
-- seats. Floors cascade to plan versions, buildings to floors; the deletes are still
-- written out so that a future FK change surfaces here rather than leaving orphans.
DELETE FROM floor_plan_version;
DELETE FROM floor;
DELETE FROM building;

DELETE FROM refresh_token;

COMMIT;
SQL

curl -s -X DELETE http://localhost:8025/api/v1/messages >/dev/null 2>&1 \
  && echo "Mailbox emptied." \
  || echo "Mailpit is not running; skipped the mailbox."

echo
echo "What is left:"
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -t -A -F' ' -c "
  SELECT u.email, u.display_name, u.role FROM app_user u ORDER BY u.role, u.email;"

echo
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -t -A -c "
  SELECT 'buildings=' || (SELECT count(*) FROM building)
      || '  floors='   || (SELECT count(*) FROM floor)
      || '  rooms='    || (SELECT count(*) FROM room)
      || '  seats='    || (SELECT count(*) FROM seat)
      || '  bookings=' || (SELECT count(*) FROM booking);"

echo
echo "Every account still uses the password: password"
echo "Reload http://localhost:3000 and start with Buildings and floors in the header."
