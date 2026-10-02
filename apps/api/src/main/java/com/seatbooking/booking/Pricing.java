package com.seatbooking.booking;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;

/** What a slot costs, from the rates modelled on the seat or its room. */
public final class Pricing {

    private Pricing() {}

    /**
     * Billed per STARTED hour rather than per second.
     *
     * <p>A 90 minute booking is charged as two hours, which is how desk space is actually
     * sold and avoids presenting someone with a bill of 4.4999.
     */
    public static BigDecimal forSlot(BigDecimal hourlyRate, Instant startsAt, Instant endsAt) {
        if (hourlyRate == null || hourlyRate.signum() == 0) {
            return BigDecimal.ZERO;
        }
        long minutes = Duration.between(startsAt, endsAt).toMinutes();
        long startedHours = (minutes + 59) / 60;
        return hourlyRate.multiply(BigDecimal.valueOf(startedHours)).setScale(2, RoundingMode.HALF_UP);
    }
}
