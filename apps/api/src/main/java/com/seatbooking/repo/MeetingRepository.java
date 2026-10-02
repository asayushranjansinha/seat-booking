package com.seatbooking.repo;

import com.seatbooking.domain.Meeting;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetingRepository extends JpaRepository<Meeting, UUID> {

    List<Meeting> findByOrganizerIdOrderByStartsAtDesc(UUID organizerId);
}
