package com.seatbooking.auth;

import com.seatbooking.domain.AppUser;
import com.seatbooking.repo.AppUserRepository;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    /** Scoped to the refresh endpoints, so it is not attached to every API call. */
    private static final String COOKIE_NAME = "sb_refresh";
    private static final String COOKIE_PATH = "/api/auth";

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final TokenService tokens;
    private final AuthProperties properties;

    public AuthController(AppUserRepository users, PasswordEncoder passwordEncoder,
                          TokenService tokens, AuthProperties properties) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.tokens = tokens;
        this.properties = properties;
    }

    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}

    public record SessionResponse(String accessToken, long expiresInSeconds, UserResponse user) {}

    public record UserResponse(UUID id, String email, String displayName, String role, UUID organizationId) {

        static UserResponse of(AppUser u) {
            return new UserResponse(u.getId(), u.getEmail(), u.getDisplayName(),
                    u.getRole().name(), u.getOrganizationId());
        }
    }

    @PostMapping("/login")
    public ResponseEntity<SessionResponse> login(@Valid @RequestBody LoginRequest request) {
        AppUser user = users.findByEmailIgnoreCase(request.email())
                // Same response whether the account is absent, disabled, or the password
                // is wrong, so the endpoint cannot be used to enumerate accounts.
                .filter(AppUser::isEnabled)
                .filter(u -> passwordEncoder.matches(request.password(), u.getPasswordHash()))
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Invalid email or password"));

        return respondWithSession(user, tokens.issue(user));
    }

    @PostMapping("/refresh")
    public ResponseEntity<SessionResponse> refresh(
            @CookieValue(name = COOKIE_NAME, required = false) String refreshCookie) {
        if (refreshCookie == null || refreshCookie.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No refresh token");
        }
        TokenService.Rotation rotation = tokens.rotate(refreshCookie)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Refresh token is invalid or has already been used"));

        AppUser user = users.findById(rotation.userId())
                .filter(AppUser::isEnabled)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown user"));

        return respondWithSession(user, tokens.reissue(user, rotation.familyId()));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @CookieValue(name = COOKIE_NAME, required = false) String refreshCookie) {
        Optional.ofNullable(refreshCookie)
                .filter(c -> !c.isBlank())
                .flatMap(tokens::rotate)
                .ifPresent(rotation -> tokens.revokeAll(rotation.userId()));
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, clearCookie().toString())
                .build();
    }

    @GetMapping("/me")
    public UserResponse me(Authentication authentication) {
        CurrentUser caller = CurrentUser.from(authentication);
        return users.findById(caller.id())
                .map(UserResponse::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown user"));
    }

    private ResponseEntity<SessionResponse> respondWithSession(AppUser user, AuthTokens issued) {
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie(issued.refreshToken()).toString())
                .body(new SessionResponse(
                        issued.accessToken(), issued.expiresInSeconds(), UserResponse.of(user)));
    }

    private ResponseCookie refreshCookie(String value) {
        return ResponseCookie.from(COOKIE_NAME, value)
                // httpOnly so no script on the page can read it, which is the whole point
                // of keeping the long-lived credential out of the access token.
                .httpOnly(true)
                .secure(false) // dev over http; set true behind TLS
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(properties.refreshTokenTtl())
                .build();
    }

    private ResponseCookie clearCookie() {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(false)
                .sameSite("Strict")
                .path(COOKIE_PATH)
                .maxAge(Duration.ZERO)
                .build();
    }
}
