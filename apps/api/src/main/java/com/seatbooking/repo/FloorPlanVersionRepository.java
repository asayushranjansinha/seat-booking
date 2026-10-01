package com.seatbooking.repo;

import com.seatbooking.domain.FloorPlanVersion;
import com.seatbooking.domain.PlanStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FloorPlanVersionRepository extends JpaRepository<FloorPlanVersion, UUID> {

    Optional<FloorPlanVersion> findByFloorIdAndStatus(UUID floorId, PlanStatus status);

    List<FloorPlanVersion> findByFloorIdOrderByVersionNoDesc(UUID floorId);

    @Query("select coalesce(max(v.versionNo), 0) from FloorPlanVersion v where v.floorId = :floorId")
    int maxVersionNo(@Param("floorId") UUID floorId);
}
