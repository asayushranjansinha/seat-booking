-- Two rules the product needs the DATABASE to hold, not the application.

-- 1. A cabin is a room you take a call in. It is bookable, but not by everyone.
--
-- Kept as a column on the room rather than a flag on each seat: the restriction is a
-- property of the space, and a cabin whose seats disagreed about who may book them is a
-- state nobody wants to debug.
ALTER TABLE room ADD COLUMN kind text NOT NULL DEFAULT 'ROOM'
    CHECK (kind IN ('ROOM', 'CABIN'));

-- 2. One desk per person at a time.
--
-- The same shape as the seat rule above it: a GiST exclusion constraint, so two requests
-- racing each other cannot both win. Checking in the service would leave the gap between
-- the check and the insert, which is the gap that double-books people.
--
-- meeting_id IS NULL is the whole subtlety. Booking a meeting writes one row per seat on
-- the table, every one of them owned by the organiser, so a six-seat meeting is six
-- overlapping bookings for one person. Without this carve-out the rule would not stop
-- someone holding two desks — it would stop anyone booking a meeting at all.
-- Existing data has to be made to obey it first, and a constraint cannot be added
-- NOT VALID the way a check or a foreign key can. Any floor that has been used already
-- holds people with two desks at once, because until now nothing stopped them.
--
-- The surplus is CANCELLED, not deleted: the row keeps its history and shows up as a
-- cancellation rather than vanishing. Earliest booking wins, which is the only ordering
-- a person would accept — you keep what you reserved first.
--
-- This is the one genuinely destructive step in the migration. It is loud on purpose.
DO $$
DECLARE
    r       record;
    removed integer := 0;
BEGIN
    FOR r IN
        SELECT id, user_id, period, created_at
        FROM booking
        WHERE status <> 'CANCELLED' AND meeting_id IS NULL
        ORDER BY user_id, created_at, id
    LOOP
        -- Only rows still standing and booked EARLIER count as the keeper, so this walks
        -- the list once and keeps the first of every overlapping run.
        IF EXISTS (
            SELECT 1 FROM booking k
            WHERE k.user_id = r.user_id
              AND k.id <> r.id
              AND k.status <> 'CANCELLED'
              AND k.meeting_id IS NULL
              AND k.period && r.period
              AND (k.created_at, k.id) < (r.created_at, r.id)
        ) THEN
            UPDATE booking SET status = 'CANCELLED', cancelled_at = now() WHERE id = r.id;
            removed := removed + 1;
        END IF;
    END LOOP;

    IF removed > 0 THEN
        RAISE WARNING 'One-desk-per-person: cancelled % overlapping booking(s). '
                      'They are kept as CANCELLED rows, not deleted.', removed;
    END IF;
END $$;

ALTER TABLE booking
    ADD CONSTRAINT booking_one_desk_per_person
    EXCLUDE USING gist (user_id WITH =, period WITH &&)
    WHERE (status <> 'CANCELLED' AND meeting_id IS NULL);

CREATE INDEX booking_user_period_idx ON booking USING gist (user_id, period)
    WHERE status <> 'CANCELLED';
