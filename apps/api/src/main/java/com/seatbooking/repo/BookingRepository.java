package com.seatbooking.repo;

import com.seatbooking.domain.Booking;
import com.seatbooking.domain.BookingStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookingRepository extends JpaRepository<Booking, UUID> {

    List<Booking> findByUserIdOrderByStartsAtDesc(UUID userId);

    List<Booking> findBySeatIdAndStatusAndEndsAtAfter(UUID seatId, BookingStatus status, Instant after);
}
