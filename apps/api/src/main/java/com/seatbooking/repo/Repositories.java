package com.seatbooking.repo;

import com.seatbooking.domain.AppUser;
import com.seatbooking.domain.Building;
import com.seatbooking.domain.Floor;
import com.seatbooking.domain.FloorPlanVersion;
import com.seatbooking.domain.Furniture;
import com.seatbooking.domain.Gate;
import com.seatbooking.domain.Organization;
import com.seatbooking.domain.PlanStatus;
import com.seatbooking.domain.RefreshToken;
import com.seatbooking.domain.Room;
import com.seatbooking.domain.RoomPartition;
import com.seatbooking.domain.Seat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** All repositories for the layout domain, grouped so the package stays readable. */
public final class Repositories {

    private Repositories() {}

    public interface OrganizationRepository extends JpaRepository<Organization, UUID> {}

    public interface AppUserRepository extends JpaRepository<AppUser, UUID> {
        Optional<AppUser> findByEmailIgnoreCase(String email);
    }

    public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
        Optional<RefreshToken> findByTokenHash(String tokenHash);

        List<RefreshToken> findByFamilyId(UUID familyId);
    }

    public interface BuildingRepository extends JpaRepository<Building, UUID> {
        List<Building> findByOrganizationId(UUID organizationId);
    }

    public interface FloorRepository extends JpaRepository<Floor, UUID> {
        List<Floor> findByBuildingIdOrderByLevel(UUID buildingId);
    }

    public interface FloorPlanVersionRepository extends JpaRepository<FloorPlanVersion, UUID> {
        Optional<FloorPlanVersion> findByFloorIdAndStatus(UUID floorId, PlanStatus status);

        List<FloorPlanVersion> findByFloorIdOrderByVersionNoDesc(UUID floorId);

        @Query("select coalesce(max(v.versionNo), 0) from FloorPlanVersion v where v.floorId = :floorId")
        int maxVersionNo(@Param("floorId") UUID floorId);
    }

    public interface RoomRepository extends JpaRepository<Room, UUID> {
        List<Room> findByPlanVersionId(UUID planVersionId);

        void deleteByPlanVersionId(UUID planVersionId);
    }

    public interface RoomPartitionRepository extends JpaRepository<RoomPartition, UUID> {
        List<RoomPartition> findByRoomIdIn(List<UUID> roomIds);
    }

    public interface GateRepository extends JpaRepository<Gate, UUID> {
        List<Gate> findByRoomIdIn(List<UUID> roomIds);
    }

    public interface FurnitureRepository extends JpaRepository<Furniture, UUID> {
        List<Furniture> findByPlanVersionId(UUID planVersionId);
    }

    public interface SeatRepository extends JpaRepository<Seat, UUID> {
        List<Seat> findByPlanVersionId(UUID planVersionId);

        List<Seat> findByTableId(UUID tableId);
    }
}
