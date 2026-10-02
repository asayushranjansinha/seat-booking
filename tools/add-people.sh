#!/usr/bin/env bash
# Add a team to the organisation that is already there, so a booking demo has more than
# three people in it.
#
# Everyone gets the same password as the seeded accounts — the hash is COPIED from one of
# them rather than generated here, because the application hashes with BCrypt and a shell
# script has no business knowing the work factor it chose.
#
# Idempotent: emails are unique per organisation, so running it twice adds nobody twice.
# Nothing is deleted and no existing account is touched.
set -euo pipefail
cd "$(dirname "$0")/.."

# -i is required: without it docker exec does not forward stdin and psql silently runs
# nothing, reporting success while inserting not a single row.
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -q -v ON_ERROR_STOP=1 <<'SQL'
SET client_min_messages TO warning;

WITH org AS (
    SELECT id FROM organization ORDER BY created_at LIMIT 1
),
-- Any existing account will do; they all share the demo password.
seed AS (
    SELECT password_hash FROM app_user ORDER BY created_at LIMIT 1
),
people (email, display_name, role) AS (
    VALUES
        ('priya@demo.test',  'Priya Raman',    'USER'),
        ('tom@demo.test',    'Tom Whitfield',  'USER'),
        ('yuki@demo.test',   'Yuki Tanaka',    'USER'),
        ('sam@demo.test',    'Sam Okafor',     'USER'),
        ('lena@demo.test',   'Lena Vogel',     'USER'),
        ('dev@demo.test',    'Dev Chaudhary',  'USER'),
        ('nina@demo.test',   'Nina Alvarez',   'MANAGER'),
        ('omar@demo.test',   'Omar Haddad',    'MANAGER')
)
INSERT INTO app_user (organization_id, email, display_name, password_hash, role)
SELECT org.id, people.email, people.display_name, seed.password_hash, people.role
FROM people, org, seed
ON CONFLICT (organization_id, email) DO NOTHING;
SQL

echo "Everyone who can sign in now:"
docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking -t -A -F'  ' -c "
  SELECT rpad(email, 20), rpad(display_name, 16), role
  FROM app_user ORDER BY role, email;"

echo
echo "Password for every account: password"
