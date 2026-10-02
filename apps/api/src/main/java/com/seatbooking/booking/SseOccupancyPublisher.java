package com.seatbooking.booking;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** In-process fan-out to everyone currently watching a floor. */
@Component
public class SseOccupancyPublisher implements OccupancyPublisher {

    private static final Logger log = LoggerFactory.getLogger(SseOccupancyPublisher.class);

    private final Map<UUID, List<SseEmitter>> watchers = new ConcurrentHashMap<>();

    public SseEmitter subscribe(UUID floorId) {
        // No timeout: the browser's EventSource reconnects on its own, and a server-side
        // timeout just produces a reconnect storm on a quiet floor.
        SseEmitter emitter = new SseEmitter(0L);
        List<SseEmitter> list = watchers.computeIfAbsent(floorId, k -> new CopyOnWriteArrayList<>());
        list.add(emitter);

        emitter.onCompletion(() -> list.remove(emitter));
        emitter.onTimeout(() -> list.remove(emitter));
        emitter.onError(e -> list.remove(emitter));

        try {
            // An immediate event so the client knows the stream is live rather than
            // waiting for the first booking to find out.
            emitter.send(SseEmitter.event().name("ready").data(Map.of("floorId", floorId.toString())));
        } catch (IOException e) {
            list.remove(emitter);
        }
        return emitter;
    }

    @Override
    public void seatChanged(UUID floorId, UUID seatId) {
        if (floorId == null) {
            return;
        }
        send(floorId, "seat-changed", Map.of("floorId", floorId.toString(), "seatId", seatId.toString()));
    }

    private void send(UUID floorId, String name, Object payload) {
        List<SseEmitter> list = watchers.get(floorId);
        if (list == null || list.isEmpty()) {
            return;
        }
        for (SseEmitter emitter : list) {
            try {
                emitter.send(SseEmitter.event().name(name).data(payload));
            } catch (Exception e) {
                // A dead client is ordinary: the tab closed. Drop it quietly.
                list.remove(emitter);
                emitter.completeWithError(e);
            }
        }
    }

    /**
     * Keep-alive.
     *
     * <p>Proxies and load balancers close an idle connection, and a floor with no bookings
     * is idle for hours. A comment every 25 seconds costs nothing and keeps it open.
     */
    @Scheduled(fixedDelay = 25_000)
    void heartbeat() {
        watchers.forEach((floorId, list) -> {
            for (SseEmitter emitter : list) {
                try {
                    emitter.send(SseEmitter.event().comment("keep-alive"));
                } catch (Exception e) {
                    list.remove(emitter);
                }
            }
        });
    }

    /** Visible for tests and diagnostics. */
    public int watcherCount(UUID floorId) {
        return watchers.getOrDefault(floorId, List.of()).size();
    }
}
