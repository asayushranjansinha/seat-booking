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

    public static void require(JdbcClient jdbc) {
        Integer seats = jdbc.sql("""
                SELECT count(*) FROM seat s
                JOIN floor_plan_version v ON v.id = s.plan_version_id
                WHERE v.status = 'PUBLISHED'
                """).query(Integer.class).single();

        if (seats == null || seats == 0) {
            throw new IllegalStateException("""

                    The demo floor is missing, so these tests have nothing to run against.

                    Restore it with:    ./tools/demo-reset.sh

                    (The seeder only runs on an empty database, so clearing the layout with
                    tools/empty-floor.sh does not bring it back by itself.)
                    """);
        }
    }
}
