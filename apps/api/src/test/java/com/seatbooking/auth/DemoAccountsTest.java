package com.seatbooking.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.TestPropertySource;

/**
 * The sign-in page's account list, and the one thing that must be true of it.
 *
 * <p>It hands out real addresses without a token, so the guard IS the feature. Asserting
 * that it answers on the development secret proves only half; the half worth testing is
 * that a secret which is not the development one closes it.
 */
class DemoAccountsTest {

    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10)).build();

    static HttpResponse<String> get(int port) {
        try {
            return HTTP.send(
                    HttpRequest.newBuilder(
                            URI.create("http://localhost:" + port + "/api/auth/demo-accounts")).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Nested
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    class OnTheDevelopmentSecret {
        @LocalServerPort private int port;

        @Test
        @DisplayName("lists the accounts, without a token, so the page can offer them")
        void listsAccounts() {
            HttpResponse<String> response = get(port);
            assertEquals(200, response.statusCode(), response.body());
            assertTrue(response.body().contains("@"), response.body());
        }
    }

    @Nested
    @SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
    @TestPropertySource(properties =
            "seatbooking.auth.jwt-secret=a-real-deployment-secret-not-the-development-one-0123456789")
    class OnARealSecret {
        @LocalServerPort private int port;

        @Test
        @DisplayName("gives nothing away once the secret is a real one")
        void saysNothing() {
            HttpResponse<String> response = get(port);
            assertEquals(404, response.statusCode(), response.body());
            assertFalse(response.body().contains("@demo.test"), response.body());
        }
    }
}
