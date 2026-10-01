package com.seatbooking.repo;

import com.seatbooking.domain.RoomPartition;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomPartitionRepository extends JpaRepository<RoomPartition, UUID> {

    List<RoomPartition> findByRoomIdIn(List<UUID> roomIds);
}
