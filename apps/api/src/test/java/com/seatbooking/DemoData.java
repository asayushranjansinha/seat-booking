package com.seatbooking;

import org.springframework.jdbc.core.simple.JdbcClient;

/**
 * Several integration tests assert against the seeded demo floor rather than building
 * their own fixtures, so they need it to be there.
 *
 * <p>The seeder only runs on a completely empty database, so anything that clears the
 * layout — `tools/empty-floor.sh`, or a person poking at the app — leaves the tests
 * failing fourteen times over with "expected 1, actual 0". That says nothing about what
 * is wrong or how to fix it. This says both, once.
 */
public final class DemoData {

    private DemoData() {}

    /**
     * Any published, bookable seat will do.
     *
     * <p>For tests about RULES rather than about the seeded layout: one desk per person,
     * who may book a cabin. Those hold on whatever floor happens to be published, so
     * tying them to the demo seed would make them fail for a reason that has nothing to
     * do with what they check.
     */
    public static void requireAnyPublishedSeats(JdbcClient jdbc) {
        Integer seats = jdbc.sql("""
                SELECT count(*) FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE v.status = 'PUBLISHED' AND s.bookable
                """).query(Integer.class).single();

        if (seats == null || seats == 0) {
            throw new IllegalStateException("""

                    No floor is published, so there is nothing bookable to test against.

                    Draw and publish a floor, or restore the demo with:  ./tools/demo-reset.sh
                    """);
        }
    }

    public static void require(JdbcClient jdbc) {
        // Checking that SOME floor is published was not enough. A floor drawn by hand in
        // the browser satisfies that and satisfies nothing these tests assert, so the
        // suite failed with "expected 3 but was 1" — a number that tells you nothing
        // about the database being wrong. The seeded floor is recognisable by its rooms.
        Integer seats = jdbc.sql("""
                SELECT count(*) FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                JOIN room r ON r.id = s.room_id
                WHERE v.status = 'PUBLISHED' AND r.name IN ('Open Studio', 'Round Room', 'The Annex')
                """).query(Integer.class).single();

        if (seats == null || seats == 0) {
            throw new IllegalStateException("""

                    The seeded demo floor is missing, so these tests have nothing to run
                    against. Another floor may well be published — one drawn by hand in the
                    browser, say — but these tests assert against the SEEDED one: three
                    rooms named Open Studio, Round Room and The Annex, four tables, 27 seats.

                    Restore it with:    ./tools/demo-reset.sh

                    (The seeder only runs on an EMPTY database, so clearing the layout —
                    with tools/empty-floor.sh or tools/blank-slate.sh — does not bring it
                    back by itself. demo-reset.sh drops the schema, which does.)
                    """);
        }
    }
}
