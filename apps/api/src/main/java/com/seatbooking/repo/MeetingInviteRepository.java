package com.seatbooking.repo;

import com.seatbooking.domain.MeetingInvite;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MeetingInviteRepository extends JpaRepository<MeetingInvite, UUID> {

    List<MeetingInvite> findByMeetingId(UUID meetingId);

    Optional<MeetingInvite> findByToken(String token);
}
