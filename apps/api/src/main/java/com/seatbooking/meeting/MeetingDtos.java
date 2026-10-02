package com.seatbooking.meeting;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class MeetingDtos {

    private MeetingDtos() {}

    public record CreateMeetingRequest(
            @NotNull UUID tableId,
            @NotBlank String title,
            String agenda,
            @NotNull Instant startsAt,
            @NotNull Instant endsAt,
            List<@Email String> inviteEmails) {}

    public record InviteResponse(UUID id, String email, String status) {}

    public record MeetingResponse(
            UUID id,
            UUID tableId,
            String tableLabel,
            String roomName,
            String title,
            String agenda,
            Instant startsAt,
            Instant endsAt,
            String organizerEmail,
            int seatCount,
            List<String> seatCodes,
            BigDecimal totalCost,
            List<InviteResponse> invites) {}

    /** What an invitee sees on the accept/decline page, holding only a token. */
    public record InviteViewResponse(
            String meetingTitle,
            String agenda,
            Instant startsAt,
            Instant endsAt,
            String roomName,
            String tableLabel,
            String organizerEmail,
            String yourEmail,
            String status) {}
}
