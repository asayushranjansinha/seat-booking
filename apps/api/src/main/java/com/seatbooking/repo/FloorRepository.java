package com.seatbooking.repo;

import com.seatbooking.domain.Floor;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FloorRepository extends JpaRepository<Floor, UUID> {

    List<Floor> findByBuildingIdOrderByLevel(UUID buildingId);
}
