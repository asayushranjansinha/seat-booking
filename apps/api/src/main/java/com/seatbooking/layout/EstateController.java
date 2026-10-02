package com.seatbooking.layout;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.booking.BookingException;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Creating and arranging the buildings and floors a layout can be drawn on. */
@RestController
@RequestMapping("/api/estate")
public class EstateController {

    private final EstateService estate;

    public EstateController(EstateService estate) {
        this.estate = estate;
    }

    /** Richer than GET /api/buildings: carries room, seat and live-booking counts. */
    @GetMapping
    public List<BuildingDtos.BuildingSummary> list(Authentication authentication) {
        return estate.list(CurrentUser.from(authentication));
    }

    @PostMapping("/buildings")
    public ResponseEntity<BuildingDtos.BuildingSummary> createBuilding(
            Authentication authentication,
            @Valid @RequestBody BuildingDtos.CreateBuildingRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(estate.createBuilding(CurrentUser.from(authentication), request));
    }

    @PatchMapping("/buildings/{id}")
    public BuildingDtos.BuildingSummary updateBuilding(
            Authentication authentication,
            @PathVariable UUID id,
            @Valid @RequestBody BuildingDtos.UpdateBuildingRequest request) {
        return estate.updateBuilding(CurrentUser.from(authentication), id, request);
    }

    @DeleteMapping("/buildings/{id}")
    public ResponseEntity<Void> deleteBuilding(Authentication authentication, @PathVariable UUID id) {
        estate.deleteBuilding(CurrentUser.from(authentication), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/buildings/{buildingId}/floors")
    public ResponseEntity<BuildingDtos.FloorSummary> createFloor(
            Authentication authentication,
            @PathVariable UUID buildingId,
            @Valid @RequestBody BuildingDtos.CreateFloorRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(estate.createFloor(CurrentUser.from(authentication), buildingId, request));
    }

    @PatchMapping("/floors/{id}")
    public BuildingDtos.FloorSummary updateFloor(
            Authentication authentication,
            @PathVariable UUID id,
            @Valid @RequestBody BuildingDtos.UpdateFloorRequest request) {
        return estate.updateFloor(CurrentUser.from(authentication), id, request);
    }

    @DeleteMapping("/floors/{id}")
    public ResponseEntity<Void> deleteFloor(Authentication authentication, @PathVariable UUID id) {
        estate.deleteFloor(CurrentUser.from(authentication), id);
        return ResponseEntity.noContent().build();
    }

    /** Throw away a floor's unpublished draft, going back to what is live. */
    @DeleteMapping("/floors/{id}/draft")
    public ResponseEntity<Void> discardDraft(Authentication authentication, @PathVariable UUID id) {
        estate.discardDraft(CurrentUser.from(authentication), id);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(BookingException.class)
    ResponseEntity<Map<String, String>> handle(BookingException e) {
        return ResponseEntity.status(e.getStatus())
                .body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }
}
