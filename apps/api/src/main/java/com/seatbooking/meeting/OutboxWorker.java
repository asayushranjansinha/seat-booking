package com.seatbooking.meeting;

import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Drains the outbox.
 *
 * <p>The transaction that created a meeting wrote those rows and committed; this picks
 * them up afterwards. That ordering is the whole design: SMTP never delays a booking, a
 * relay that is down cannot fail one, and an invite cannot be lost because it only ever
 * existed inside a connection that dropped.
 */
@Component
public class OutboxWorker {

    private final OutboxDelivery delivery;

    public OutboxWorker(OutboxDelivery delivery) {
        this.delivery = delivery;
    }

    @Scheduled(fixedDelay = 2_000)
    public void tick() {
        for (UUID id : delivery.claim()) {
            delivery.deliver(id);
        }
    }
}
