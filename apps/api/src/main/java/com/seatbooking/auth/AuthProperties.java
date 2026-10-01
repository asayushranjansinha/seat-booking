package com.seatbooking.auth;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "seatbooking.auth")
public record AuthProperties(String jwtSecret, Duration accessTokenTtl, Duration refreshTokenTtl) {

    public static final String DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789abcdef";
}
