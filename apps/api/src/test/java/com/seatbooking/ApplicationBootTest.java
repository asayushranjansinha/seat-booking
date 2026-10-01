package com.seatbooking;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Boots the whole application against the docker-compose Postgres.
 *
 * <p>This is the test that catches a drift between the Flyway migrations and the JPA
 * entities, because {@code ddl-auto: validate} fails the context start when they
 * disagree. It is worth having as a test rather than a manual run: the schema is written
 * as explicit SQL precisely because Hibernate cannot express it, which means nothing else
 * checks that the entities still match.
 */
@SpringBootTest
class ApplicationBootTest {

    @Autowired
    private DataSource dataSource;

    @Test
    @DisplayName("context starts, so Flyway migrations and JPA entities agree")
    void contextLoads() {
        // Reaching here at all means ddl-auto=validate passed against the migrated schema.
    }

    @Test
    @DisplayName("the constraints Hibernate cannot express are actually present")
    void databaseLevelConstraintsExist() throws Exception {
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
            assertEquals(1, count(s, """
                    SELECT count(*) FROM pg_constraint
                    WHERE conname = 'booking_no_overlap' AND contype = 'x'
                    """), "the exclusion constraint that prevents double-booking");

            assertEquals(1, count(s, """
                    SELECT count(*) FROM pg_constraint
                    WHERE conname = 'booking_max_6h' AND contype = 'c'
                    """), "the 6 hour booking cap");

            assertEquals(1, count(s, """
                    SELECT count(*) FROM pg_attribute
                    WHERE attrelid = 'booking'::regclass AND attname = 'period'
                      AND attgenerated = 's'
                    """), "period must be a STORED generated column, not written by JPA");

            assertEquals(1, count(s, "SELECT count(*) FROM pg_extension WHERE extname = 'btree_gist'"),
                    "btree_gist, without which the exclusion constraint cannot index seat_id");

            assertEquals(2, count(s, """
                    SELECT count(*) FROM pg_indexes
                    WHERE tablename = 'floor_plan_version'
                      AND indexname IN ('plan_version_one_draft_per_floor',
                                        'plan_version_one_published_per_floor')
                    """), "at most one draft and one published version per floor");

            assertTrue(count(s, """
                    SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = 'public' AND column_name = 'organization_id'
                    """) >= 10, "organization_id belongs on every tenant-scoped table from day one");
        }
    }

    private static int count(Statement s, String sql) throws Exception {
        try (ResultSet rs = s.executeQuery(sql)) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
