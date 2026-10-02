package com.seatbooking.booking;

import java.util.UUID;

/**
 * Tells watchers of a floor that one seat's occupancy changed.
 *
 * <p>An interface with an in-process implementation for v1. Occupancy is one-directional
 * and SSE reconnects by itself, so WebSockets would add protocol for nothing. When the
 * API runs on more than one instance this becomes a Redis pub/sub implementation and
 * nothing that calls it has to change.
 */
public interface OccupancyPublisher {

    void seatChanged(UUID floorId, UUID seatId);
}
