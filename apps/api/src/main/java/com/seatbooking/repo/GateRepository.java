package com.seatbooking.repo;

import com.seatbooking.domain.Gate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GateRepository extends JpaRepository<Gate, UUID> {

    List<Gate> findByRoomIdIn(List<UUID> roomIds);
}
