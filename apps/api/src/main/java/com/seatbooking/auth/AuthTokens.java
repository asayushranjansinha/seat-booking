package com.seatbooking.auth;

/**
 * @param accessToken short-lived JWT, held in memory by the client and sent as a bearer
 * @param refreshToken opaque, high-entropy, delivered only as an httpOnly cookie
 */
public record AuthTokens(String accessToken, String refreshToken, long expiresInSeconds) {}
