package com.seatbooking.auth;

import com.seatbooking.domain.AppUser;
import com.seatbooking.domain.RefreshToken;
import com.seatbooking.repo.RefreshTokenRepository;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues short-lived access JWTs and rotating opaque refresh tokens.
 *
 * <p>Refresh tokens are stored only as a SHA-256 hash, so a database leak does not hand
 * over usable sessions, and each one is replaced the moment it is redeemed. Presenting an
 * already-redeemed token is the signature of a stolen cookie being replayed, so the whole
 * token family is revoked rather than just that token.
 */
@Service
public class TokenService {

    private static final Logger log = LoggerFactory.getLogger(TokenService.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JwtEncoder jwtEncoder;
    private final RefreshTokenRepository refreshTokens;
    private final AuthProperties properties;

    public TokenService(JwtEncoder jwtEncoder, RefreshTokenRepository refreshTokens,
                        AuthProperties properties) {
        this.jwtEncoder = jwtEncoder;
        this.refreshTokens = refreshTokens;
        this.properties = properties;
    }

    @Transactional
    public AuthTokens issue(AppUser user) {
        return issue(user, UUID.randomUUID());
    }

    private AuthTokens issue(AppUser user, UUID familyId) {
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("seat-booking")
                .issuedAt(now)
                .expiresAt(now.plus(properties.accessTokenTtl()))
                .subject(user.getId().toString())
                .claim("email", user.getEmail())
                .claim("name", user.getDisplayName())
                .claim("org", user.getOrganizationId().toString())
                // Spring Security maps this to ROLE_ authorities; see SecurityConfig.
                .claim("role", user.getRole().name())
                .build();

        String accessToken = jwtEncoder
                .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();

        String refreshRaw = randomToken();
        refreshTokens.save(new RefreshToken(
                user.getId(), sha256(refreshRaw), familyId, now.plus(properties.refreshTokenTtl())));

        return new AuthTokens(accessToken, refreshRaw, properties.accessTokenTtl().toSeconds());
    }

    /**
     * Redeem a refresh token, rotating it. Returns empty when the token is unknown,
     * expired, or already used.
     */
    @Transactional
    public Optional<Rotation> rotate(String refreshRaw) {
        Instant now = Instant.now();
        Optional<RefreshToken> found = refreshTokens.findByTokenHash(sha256(refreshRaw));
        if (found.isEmpty()) {
            return Optional.empty();
        }
        RefreshToken token = found.get();

        if (!token.isActive(now)) {
            // A token that has already been revoked is being presented again. Either the
            // legitimate client replayed it, or someone stole it; we cannot tell which,
            // so the safe reading is theft and the entire family dies.
            log.warn("Refresh token replay detected for family {}; revoking the family", token.getFamilyId());
            List<RefreshToken> family = refreshTokens.findByFamilyId(token.getFamilyId());
            family.forEach(t -> t.revoke(now));
            refreshTokens.saveAll(family);
            return Optional.empty();
        }

        token.revoke(now);
        refreshTokens.save(token);
        return Optional.of(new Rotation(token.getUserId(), token.getFamilyId()));
    }

    @Transactional
    public AuthTokens reissue(AppUser user, UUID familyId) {
        return issue(user, familyId);
    }

    @Transactional
    public void revokeAll(UUID userId) {
        Instant now = Instant.now();
        List<RefreshToken> active = refreshTokens.findByUserIdAndRevokedAtIsNull(userId);
        active.forEach(t -> t.revoke(now));
        refreshTokens.saveAll(active);
    }

    public record Rotation(UUID userId, UUID familyId) {}

    private static String randomToken() {
        byte[] bytes = new byte[48];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return Base64.getEncoder()
                    .encodeToString(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
