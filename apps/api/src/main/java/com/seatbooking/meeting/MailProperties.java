package com.seatbooking.meeting;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param from the envelope sender for every outbound message
 * @param publicBaseUrl where an invitee's accept/decline link points
 * @param batchSize how many outbox rows one worker tick claims
 */
@ConfigurationProperties(prefix = "seatbooking.mail")
public record MailProperties(String from, String publicBaseUrl, int batchSize) {}
