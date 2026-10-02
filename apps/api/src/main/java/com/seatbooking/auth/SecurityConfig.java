package com.seatbooking.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * Self-hosted JWT auth: an HMAC-signed access token sent as a bearer, and an opaque
 * refresh token delivered only as an httpOnly cookie so script running on the page cannot
 * read it.
 *
 * <p>Stateless, so no session fixation surface and no server-side session store to scale.
 */
@Configuration
@EnableConfigurationProperties({
        AuthProperties.class,
        com.seatbooking.booking.BookingProperties.class,
        com.seatbooking.meeting.MailProperties.class})
@EnableMethodSecurity
public class SecurityConfig {

    private final AuthProperties properties;

    public SecurityConfig(AuthProperties properties, Environment environment) {
        this.properties = properties;
        boolean prodProfile = List.of(environment.getActiveProfiles()).contains("prod");
        if (prodProfile && AuthProperties.DEV_SECRET.equals(properties.jwtSecret())) {
            throw new IllegalStateException(
                    "seatbooking.auth.jwt-secret is still the development default. "
                            + "Set SEATBOOKING_AUTH_JWT_SECRET before running with the prod profile.");
        }
    }

    private SecretKeySpec secretKey() {
        return new SecretKeySpec(properties.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder() {
        return new NimbusJwtEncoder(new ImmutableSecret<>(secretKey()));
    }

    @Bean
    JwtDecoder jwtDecoder() {
        return NimbusJwtDecoder.withSecretKey(secretKey())
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /** Maps the single "role" claim onto the ROLE_ authority Spring Security expects. */
    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthorityPrefix("ROLE_");
        authorities.setAuthoritiesClaimName("role");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationConverter converter)
            throws Exception {
        return http
                // Stateless bearer auth, so there is no session for CSRF to attack. The
                // refresh cookie is SameSite=Strict and only ever read by /auth/refresh.
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/auth/login", "/api/auth/refresh", "/api/auth/logout").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        // Editing a layout is an admin act. Reading a published plan is
                        // not, because every role needs it to book.
                        .requestMatchers(HttpMethod.PUT, "/api/plan-versions/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/plan-versions/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/api/plan-versions/**").hasRole("ADMIN")
                        .requestMatchers("/api/floors/*/draft").hasRole("ADMIN")
                        // Booking is for everyone; only editing a layout is an admin act.
                        .requestMatchers("/api/bookings/**").authenticated()
                        // The SSE stream is open because EventSource cannot send an
                        // Authorization header, and putting the token in the query string
                        // would write it into every access log and proxy cache. The
                        // stream therefore carries NO personal data: it says only that
                        // some seat on some floor changed, and the client re-reads the
                        // authenticated occupancy endpoint to learn how. Tightening this
                        // means issuing a short-lived single-use stream ticket.
                        .requestMatchers(HttpMethod.GET, "/api/floors/*/occupancy/stream").permitAll()
                        .requestMatchers("/api/floors/*/occupancy").authenticated()
                        // An invitee may have no account; the token IS the credential and
                        // grants nothing beyond seeing and answering that one invitation.
                        .requestMatchers("/api/invites/**").permitAll()
                        .requestMatchers("/api/meetings/**").authenticated()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(converter)))
                .build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of("http://localhost:3000"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("ETag", "Location"));
        // Required for the httpOnly refresh cookie to be sent cross-origin in dev.
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
