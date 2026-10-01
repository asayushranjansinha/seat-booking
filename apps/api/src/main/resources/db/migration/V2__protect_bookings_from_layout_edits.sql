-- A booking must never be destroyed as a side effect of editing a layout.
--
-- booking.seat_id was ON DELETE CASCADE, which meant that removing a seat from a draft
-- deleted any booking on it, silently, inside the ordinary scene save. The publish guard
-- that reports affected bookings could never fire, because the cascade had already run at
-- the SQL level before the guard was reached.
--
-- RESTRICT turns that silent data loss into a loud, immediate error. The application now
-- re-points bookings onto the new version's seats at publish time, and refuses to publish
-- when a booked seat has no counterpart in the incoming layout.

ALTER TABLE booking DROP CONSTRAINT booking_seat_id_fkey;

ALTER TABLE booking ADD CONSTRAINT booking_seat_id_fkey
    FOREIGN KEY (seat_id) REFERENCES seat (id) ON DELETE RESTRICT;

-- Matching bookings to the incoming layout is done on seat code, because the code on the
-- back of the chair is what a seat means to the person who booked it.
CREATE INDEX IF NOT EXISTS seat_code_idx ON seat (plan_version_id, code);
