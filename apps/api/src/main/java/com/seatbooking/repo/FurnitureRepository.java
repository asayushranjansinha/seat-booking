package com.seatbooking.repo;

import com.seatbooking.domain.Furniture;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FurnitureRepository extends JpaRepository<Furniture, UUID> {

    List<Furniture> findByPlanVersionId(UUID planVersionId);
}
