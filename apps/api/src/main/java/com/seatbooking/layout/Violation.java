package com.seatbooking.layout;

import java.util.UUID;

/**
 * One thing wrong with a layout. Collected rather than thrown, so the editor can paint
 * every problem at once instead of surfacing them one reload at a time.
 */
public record Violation(Severity severity, String code, String entityType, UUID entityId, String message) {

    public enum Severity {
        /** Publishing is refused. */
        ERROR,
        /** Publishing is allowed; the editor still flags it. */
        WARNING
    }

    public static Violation error(String code, String entityType, UUID id, String message) {
        return new Violation(Severity.ERROR, code, entityType, id, message);
    }

    public static Violation warning(String code, String entityType, UUID id, String message) {
        return new Violation(Severity.WARNING, code, entityType, id, message);
    }
}
