package com.seatbooking.booking;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param maxAdvance how far ahead a seat may be booked
 * @param maxDuration the longest single booking
 */
@ConfigurationProperties(prefix = "seatbooking.booking")
public record BookingProperties(Duration maxAdvance, Duration maxDuration) {}
