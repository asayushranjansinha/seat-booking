package com.seatbooking.repo;

import com.seatbooking.domain.Seat;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SeatRepository extends JpaRepository<Seat, UUID> {

    List<Seat> findByPlanVersionId(UUID planVersionId);

    List<Seat> findByTableId(UUID tableId);
}
