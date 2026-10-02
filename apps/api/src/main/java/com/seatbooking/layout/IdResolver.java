package com.seatbooking.layout;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Decides which ids a scene save may keep and which must be minted fresh.
 *
 * <p>An id the client sends is reused only when it already belongs to the version being
 * saved, which keeps entity identity stable across ordinary edits so the editor's
 * selection and any bookings survive a save.
 *
 * <p>Any other id is remapped. This matters because cloning a published version into a
 * draft hands the draft the published version's ids: adopting them makes JPA merge onto
 * the published rows and relocate them into the draft, which silently empties the version
 * that was cloned. The same remapping is applied to foreign references, so a room id
 * rewritten here is followed by the furniture and seats that point at it.
 */
final class IdResolver {

    private final Set<UUID> ownedByThisVersion;
    private final Set<UUID> ownedByAnotherVersion;
    private final Map<UUID, UUID> remapped = new HashMap<>();

    IdResolver(Set<UUID> ownedByThisVersion, Set<UUID> ownedByAnotherVersion) {
        this.ownedByThisVersion = ownedByThisVersion;
        this.ownedByAnotherVersion = ownedByAnotherVersion;
    }

    /**
     * The id to persist this entity under.
     *
     * <p>Only an id belonging to ANOTHER version is remapped. An id this version already
     * owns is kept so entity identity survives an ordinary edit, and an id that exists
     * nowhere yet is kept too: that is a client minting a uuid for something it has just
     * drawn, and rewriting it would leave the editor holding a selection that no longer
     * resolves. Only the clone case is actually dangerous.
     */
    UUID resolve(UUID clientId) {
        if (clientId == null) {
            return UUID.randomUUID();
        }
        if (ownedByThisVersion.contains(clientId)) {
            return clientId;
        }
        if (!ownedByAnotherVersion.contains(clientId)) {
            return clientId;
        }
        return remapped.computeIfAbsent(clientId, k -> UUID.randomUUID());
    }

    /**
     * Follow a foreign reference through the same remapping. The referenced entity is
     * always written before the entity referring to it, so the mapping already exists.
     */
    UUID reference(UUID clientId) {
        if (clientId == null) {
            return null;
        }
        UUID mapped = remapped.get(clientId);
        return mapped != null ? mapped : clientId;
    }
}
