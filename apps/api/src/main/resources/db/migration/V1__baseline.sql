-- Baseline schema for the parametric seat-booking platform.
--
-- Written as explicit SQL rather than generated from entities: this schema depends on an
-- extension, a generated column and an exclusion constraint, none of which Hibernate DDL
-- can express. ddl-auto never goes beyond `validate`.
--
-- The booking tables are created here, in the very first migration, even though booking
-- itself is M2 work. Adding them later would mean a migration that touches the core
-- geometry tables once they already hold data.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- tenancy & identity

-- A co-working product is inherently multi-tenant. organization_id is on every table
-- from day one, seeded with a single org: the column costs nothing now and is a rewrite
-- later.
CREATE TABLE organization (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    email           text        NOT NULL,
    display_name    text        NOT NULL,
    password_hash   text        NOT NULL,
    role            text        NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'USER')),
    enabled         boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_user_email_unique_per_org UNIQUE (organization_id, email)
);

CREATE INDEX app_user_email_idx ON app_user (lower(email));

-- Refresh tokens are stored hashed and rotated on every use, so a stolen cookie is
-- usable at most once before the family is revoked.
CREATE TABLE refresh_token (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    family_id    uuid        NOT NULL,
    issued_at    timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    replaced_by  uuid REFERENCES refresh_token (id) ON DELETE SET NULL
);

CREATE INDEX refresh_token_user_idx ON refresh_token (user_id) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------------------- buildings

CREATE TABLE building (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    address         text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE floor (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    building_id     uuid        NOT NULL REFERENCES building (id) ON DELETE CASCADE,
    name            text        NOT NULL,
    level           integer     NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT floor_level_unique_per_building UNIQUE (building_id, level)
);

-- Admins edit layouts that already carry live bookings, so ALL geometry hangs off a
-- version. Editing clones the published version into a draft; publishing is atomic.
CREATE TABLE floor_plan_version (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    floor_id        uuid        NOT NULL REFERENCES floor (id) ON DELETE CASCADE,
    version_no      integer     NOT NULL,
    status          text        NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    -- Optimistic concurrency for the scene save, surfaced to clients as an ETag, so two
    -- admins editing the same draft cannot silently clobber one another.
    revision        bigint      NOT NULL DEFAULT 0,
    published_at    timestamptz,
    created_by      uuid REFERENCES app_user (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plan_version_no_unique_per_floor UNIQUE (floor_id, version_no)
);

-- At most one draft and one published version per floor. Partial unique indexes state
-- that invariant in the database rather than hoping the service layer maintains it.
CREATE UNIQUE INDEX plan_version_one_draft_per_floor
    ON floor_plan_version (floor_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX plan_version_one_published_per_floor
    ON floor_plan_version (floor_id) WHERE status = 'PUBLISHED';

-- -------------------------------------------------------------------------- geometry
-- Shapes and transforms are JSONB. PostGIS is unnecessary: JTS in the application layer
-- is the authority for validation, and remains the scale path if that ever changes.

CREATE TABLE room (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    plan_version_id  uuid        NOT NULL REFERENCES floor_plan_version (id) ON DELETE CASCADE,
    name             text        NOT NULL,
    shape            jsonb       NOT NULL,
    transform        jsonb       NOT NULL,
    height           numeric(6, 3) NOT NULL DEFAULT 2.700,
    hourly_rate      numeric(12, 2),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_plan_version_idx ON room (plan_version_id);

-- "partition" is a SQL keyword; the table is named room_partition to keep queries
-- unambiguous without quoting.
CREATE TABLE room_partition (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    room_id          uuid        NOT NULL REFERENCES room (id) ON DELETE CASCADE,
    polyline         jsonb       NOT NULL,
    thickness        numeric(6, 3) NOT NULL DEFAULT 0.100,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_partition_room_idx ON room_partition (room_id);

-- A gate is positioned ON a wall: the edge index of the room outline plus a parameter
-- along it. Storing it that way means resizing the room carries its gates, exactly as
-- local transforms carry seats.
CREATE TABLE gate (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    room_id          uuid        NOT NULL REFERENCES room (id) ON DELETE CASCADE,
    wall_edge_idx    integer     NOT NULL CHECK (wall_edge_idx >= 0),
    offset_t         numeric(9, 6) NOT NULL CHECK (offset_t >= 0 AND offset_t <= 1),
    width            numeric(6, 3) NOT NULL CHECK (width > 0),
    type             text        NOT NULL CHECK (type IN ('DOOR', 'GATE', 'EMERGENCY')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gate_room_idx ON gate (room_id);

CREATE TABLE furniture (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    plan_version_id  uuid        NOT NULL REFERENCES floor_plan_version (id) ON DELETE CASCADE,
    room_id          uuid        NOT NULL REFERENCES room (id) ON DELETE CASCADE,
    kind             text        NOT NULL CHECK (kind IN ('TABLE', 'DESK', 'CABINET', 'PLANT', 'OTHER')),
    label            text,
    shape            jsonb       NOT NULL,
    transform        jsonb       NOT NULL,
    height           numeric(6, 3) NOT NULL DEFAULT 0.750,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX furniture_plan_version_idx ON furniture (plan_version_id);
CREATE INDEX furniture_room_idx ON furniture (room_id);

-- A seat stores local_transform relative to its PARENT: the table when it has one,
-- otherwise the room. Rotating a table changes one transform and every seat follows;
-- no seat row is rewritten, so nothing can drift out of alignment.
--
-- world_x / world_y / world_rot are a denormalised cache written at publish time, so
-- read paths never recompute the transform chain. They are never the source of truth.
CREATE TABLE seat (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    plan_version_id  uuid        NOT NULL REFERENCES floor_plan_version (id) ON DELETE CASCADE,
    room_id          uuid        NOT NULL REFERENCES room (id) ON DELETE CASCADE,
    table_id         uuid        REFERENCES furniture (id) ON DELETE CASCADE,
    code             text        NOT NULL,
    shape            jsonb       NOT NULL,
    local_transform  jsonb       NOT NULL,
    placement        jsonb,
    seat_index       integer     NOT NULL DEFAULT 0,
    is_override      boolean     NOT NULL DEFAULT false,
    bookable         boolean     NOT NULL DEFAULT true,
    hourly_rate      numeric(12, 2),
    world_x          double precision,
    world_y          double precision,
    world_rot        double precision,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT seat_code_unique_per_version UNIQUE (plan_version_id, code)
);

CREATE INDEX seat_plan_version_idx ON seat (plan_version_id);
CREATE INDEX seat_table_idx ON seat (table_id);

-- -------------------------------------------------------------------------- bookings

CREATE TABLE booking (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    seat_id          uuid        NOT NULL REFERENCES seat (id) ON DELETE CASCADE,
    user_id          uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    meeting_id       uuid,
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    status           text        NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    cost             numeric(12, 2) NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    cancelled_at     timestamptz,
    CONSTRAINT booking_ends_after_start CHECK (ends_at > starts_at)
);

-- JPA writes starts_at / ends_at as ordinary columns and Postgres derives the range, so
-- entities stay plain JPA with no custom Hibernate range type.
ALTER TABLE booking ADD COLUMN period tstzrange
    GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED;

-- Double-booking is prevented one layer below the application. "Check then insert" loses
-- races under concurrency; here both inserts genuinely reach the database and the
-- exclusion constraint admits exactly one. The service layer only has to translate the
-- violation into a 409, which is far less code than a correct locking scheme.
ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
    EXCLUDE USING gist (seat_id WITH =, period WITH &&)
    WHERE (status <> 'CANCELLED');

-- The 6 hour cap is a pure function of the row, so it is a check constraint. The 6 day
-- advance window depends on now(), so it stays application-level validation.
ALTER TABLE booking ADD CONSTRAINT booking_max_6h
    CHECK (ends_at - starts_at <= interval '6 hours');

CREATE INDEX booking_seat_period_idx ON booking USING gist (seat_id, period);
CREATE INDEX booking_user_idx ON booking (user_id, starts_at DESC);

CREATE TABLE meeting (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    organizer_id     uuid        NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    table_id         uuid        NOT NULL REFERENCES furniture (id) ON DELETE CASCADE,
    title            text        NOT NULL,
    agenda           text,
    starts_at        timestamptz NOT NULL,
    ends_at          timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meeting_ends_after_start CHECK (ends_at > starts_at)
);

ALTER TABLE booking ADD CONSTRAINT booking_meeting_fk
    FOREIGN KEY (meeting_id) REFERENCES meeting (id) ON DELETE CASCADE;

CREATE TABLE meeting_invite (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id  uuid        NOT NULL REFERENCES meeting (id) ON DELETE CASCADE,
    email       text        NOT NULL,
    user_id     uuid        REFERENCES app_user (id) ON DELETE SET NULL,
    status      text        NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED')),
    token       text        NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meeting_invite_email_unique UNIQUE (meeting_id, email)
);

-- Transactional outbox: the booking transaction writes the row, a scheduled poller
-- sends it. SMTP never blocks a request, and an SMTP outage never loses an invite.
CREATE TABLE email_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
    recipient       text        NOT NULL,
    subject         text        NOT NULL,
    body            text        NOT NULL,
    ics             text,
    status          text        NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    attempts        integer     NOT NULL DEFAULT 0,
    last_error      text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at)
    WHERE status = 'PENDING';
