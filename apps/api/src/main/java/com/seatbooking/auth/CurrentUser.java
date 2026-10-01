package com.seatbooking.auth;

import com.seatbooking.domain.Role;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;

/** The authenticated caller, read from the access token rather than the database. */
public record CurrentUser(UUID id, UUID organizationId, String email, Role role) {

    public static CurrentUser from(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof Jwt jwt)) {
            throw new IllegalStateException("no authenticated user on the request");
        }
        return new CurrentUser(
                UUID.fromString(jwt.getSubject()),
                UUID.fromString(jwt.getClaimAsString("org")),
                jwt.getClaimAsString("email"),
                Role.valueOf(jwt.getClaimAsString("role")));
    }
}
