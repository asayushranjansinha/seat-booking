package com.seatbooking.booking;

import com.seatbooking.auth.CurrentUser;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api")
public class BookingController {

    private final BookingService bookings;
    private final SseOccupancyPublisher sse;

    public BookingController(BookingService bookings, SseOccupancyPublisher sse) {
        this.bookings = bookings;
        this.sse = sse;
    }

    @PostMapping("/bookings")
    public ResponseEntity<BookingDtos.BookingResponse> book(
            Authentication authentication,
            @Valid @RequestBody BookingDtos.CreateBookingRequest request) {
        BookingDtos.BookingResponse created = bookings.book(CurrentUser.from(authentication), request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/bookings/mine")
    public List<BookingDtos.BookingResponse> mine(Authentication authentication) {
        return bookings.myBookings(CurrentUser.from(authentication));
    }

    @DeleteMapping("/bookings/{id}")
    public BookingDtos.BookingResponse cancel(Authentication authentication, @PathVariable UUID id) {
        return bookings.cancel(CurrentUser.from(authentication), id);
    }

    /**
     * How every seat on the floor stands over the window being viewed.
     *
     * <p>The window is a parameter rather than "now", because a seat is only free or
     * taken relative to a moment, which is exactly why the UI has a time scrubber.
     */
    @GetMapping("/floors/{floorId}/occupancy")
    public BookingDtos.OccupancyResponse occupancy(
            Authentication authentication,
            @PathVariable UUID floorId,
            @RequestParam Instant from,
            @RequestParam Instant to) {
        return bookings.occupancy(CurrentUser.from(authentication), floorId, from, to);
    }

    /** Deltas as they happen, so an open floor plan does not have to poll. */
    @GetMapping(value = "/floors/{floorId}/occupancy/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID floorId) {
        return sse.subscribe(floorId);
    }

    @ExceptionHandler(BookingException.class)
    ResponseEntity<Map<String, String>> handle(BookingException e) {
        return ResponseEntity.status(e.getStatus())
                .body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }
}
