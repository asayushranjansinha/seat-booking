package com.seatbooking.repo;

import com.seatbooking.domain.Building;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BuildingRepository extends JpaRepository<Building, UUID> {

    List<Building> findByOrganizationId(UUID organizationId);
}
