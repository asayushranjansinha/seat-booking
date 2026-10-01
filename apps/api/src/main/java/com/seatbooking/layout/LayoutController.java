package com.seatbooking.layout;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.domain.Building;
import com.seatbooking.domain.Floor;
import com.seatbooking.domain.FloorPlanVersion;
import com.seatbooking.domain.PlanStatus;
import com.seatbooking.repo.BuildingRepository;
import com.seatbooking.repo.FloorPlanVersionRepository;
import com.seatbooking.repo.FloorRepository;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class LayoutController {

    private final LayoutService layouts;
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final FloorPlanVersionRepository versions;

    public LayoutController(LayoutService layouts, BuildingRepository buildings,
                            FloorRepository floors, FloorPlanVersionRepository versions) {
        this.layouts = layouts;
        this.buildings = buildings;
        this.floors = floors;
        this.versions = versions;
    }

    public record BuildingDto(UUID id, String name, String address, List<FloorDto> floors) {}

    public record FloorDto(UUID id, String name, int level, UUID publishedVersionId, UUID draftVersionId) {}

    @GetMapping("/buildings")
    public List<BuildingDto> listBuildings(Authentication authentication) {
        CurrentUser caller = CurrentUser.from(authentication);
        return buildings.findByOrganizationId(caller.organizationId()).stream()
                .map(this::toDto)
                .toList();
    }

    private BuildingDto toDto(Building b) {
        List<FloorDto> floorDtos = floors.findByBuildingIdOrderByLevel(b.getId()).stream()
                .map(f -> new FloorDto(
                        f.getId(), f.getName(), f.getLevel(),
                        versions.findByFloorIdAndStatus(f.getId(), PlanStatus.PUBLISHED)
                                .map(FloorPlanVersion::getId).orElse(null),
                        versions.findByFloorIdAndStatus(f.getId(), PlanStatus.DRAFT)
                                .map(FloorPlanVersion::getId).orElse(null)))
                .toList();
        return new BuildingDto(b.getId(), b.getName(), b.getAddress(), floorDtos);
    }

    @GetMapping("/plan-versions/{id}/scene")
    public ResponseEntity<SceneDto> getScene(@PathVariable UUID id) {
        SceneDto scene = layouts.getScene(id);
        return ResponseEntity.ok().eTag(etag(scene.revision())).body(scene);
    }

    /**
     * Save the whole scene. {@code If-Match} carries the revision the client loaded, so a
     * save built on stale data is refused with 412 rather than overwriting someone else.
     */
    @PutMapping("/plan-versions/{id}/scene")
    public ResponseEntity<SceneDto> saveScene(
            @PathVariable UUID id,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @Valid @RequestBody SceneDto scene) {
        SceneDto saved = layouts.saveScene(id, scene, parseEtag(ifMatch));
        return ResponseEntity.ok().eTag(etag(saved.revision())).body(saved);
    }

    @PostMapping("/plan-versions/{id}/validate")
    public List<Violation> validate(@PathVariable UUID id) {
        return layouts.validate(id);
    }

    @PostMapping("/plan-versions/{id}/publish")
    public ResponseEntity<LayoutService.PublishResult> publish(@PathVariable UUID id) {
        LayoutService.PublishResult result = layouts.publish(id);
        // A refusal is a complete answer, not an error: the body carries exactly what is
        // wrong, so the editor can paint it. 409 says "not done", the body says why.
        return ResponseEntity.status(result.published() ? HttpStatus.OK : HttpStatus.CONFLICT)
                .body(result);
    }

    @PostMapping("/floors/{floorId}/draft")
    public SceneDto createDraft(@PathVariable UUID floorId, Authentication authentication) {
        CurrentUser caller = CurrentUser.from(authentication);
        Floor floor = floors.findById(floorId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "No such floor: " + floorId));
        if (!floor.getOrganizationId().equals(caller.organizationId())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such floor: " + floorId);
        }
        return layouts.createDraft(floorId, caller.organizationId(), caller.id());
    }

    @GetMapping("/floors/{floorId}/published")
    public ResponseEntity<SceneDto> published(@PathVariable UUID floorId) {
        FloorPlanVersion version = versions.findByFloorIdAndStatus(floorId, PlanStatus.PUBLISHED)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "This floor has no published layout yet."));
        SceneDto scene = layouts.getScene(version.getId());
        return ResponseEntity.ok().eTag(etag(scene.revision())).body(scene);
    }

    private static String etag(long revision) {
        return "\"" + revision + "\"";
    }

    private static Long parseEtag(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank() || "*".equals(ifMatch)) {
            return null;
        }
        try {
            return Long.parseLong(ifMatch.replace("W/", "").replace("\"", "").trim());
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "If-Match must be the revision returned by the last scene read");
        }
    }
}
