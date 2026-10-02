# How these scripts reach Postgres.
#
# The committed compose stack runs Postgres in a container, but a local setup may run it
# natively instead — on an 8 GB laptop the Docker VM costs more memory than the database
# does. Prefer the container when it is genuinely up, so the compose workflow is
# unchanged, and otherwise talk to a native server on localhost.
#
# Use it as an array, which keeps each call site's own flags intact:
#     "${PSQL[@]}" -tAc "select 1"
#     "${PSQL[@]}" -q -v ON_ERROR_STOP=1 <<'SQL' ... SQL

# Homebrew's postgresql@17 is keg-only, so psql is not on a non-interactive PATH.
if ! command -v psql >/dev/null 2>&1 && [ -x /opt/homebrew/opt/postgresql@17/bin/psql ]; then
  PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
  export PATH
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'seatbooking-postgres'; then
  # -i matters: without it docker exec does not forward stdin and a heredoc runs empty.
  PSQL=(docker exec -i seatbooking-postgres psql -U seatbooking -d seatbooking)
  SB_DB_WHERE="container seatbooking-postgres"
else
  export PGPASSWORD="${PGPASSWORD:-seatbooking}"
  PSQL=(psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U seatbooking -d seatbooking)
  SB_DB_WHERE="native ${PGHOST:-localhost}:${PGPORT:-5432}"
fi
