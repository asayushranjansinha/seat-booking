package com.seatbooking.repo;

import com.seatbooking.domain.Room;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomRepository extends JpaRepository<Room, UUID> {

    List<Room> findByPlanVersionId(UUID planVersionId);

    void deleteByPlanVersionId(UUID planVersionId);
}
