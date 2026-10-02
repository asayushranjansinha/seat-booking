package com.seatbooking.meeting;

import com.seatbooking.auth.CurrentUser;
import com.seatbooking.booking.BookingException;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class MeetingController {

    private final MeetingService meetings;

    public MeetingController(MeetingService meetings) {
        this.meetings = meetings;
    }

    @PostMapping("/meetings")
    public ResponseEntity<MeetingDtos.MeetingResponse> create(
            Authentication authentication,
            @Valid @RequestBody MeetingDtos.CreateMeetingRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(meetings.create(CurrentUser.from(authentication), request));
    }

    @GetMapping("/meetings/mine")
    public List<MeetingDtos.MeetingResponse> mine(Authentication authentication) {
        return meetings.myMeetings(CurrentUser.from(authentication));
    }

    /**
     * The invitee's view, reached from the link in the email.
     *
     * <p>Unauthenticated on purpose: an invitee may have no account, and the token is the
     * credential. It grants nothing except the right to see and answer this one invite.
     */
    @GetMapping("/invites/{token}")
    public MeetingDtos.InviteViewResponse view(@PathVariable String token) {
        return meetings.viewInvite(token);
    }

    @PostMapping("/invites/{token}/respond")
    public MeetingDtos.InviteViewResponse respond(
            @PathVariable String token,
            @RequestParam String reply) {
        if (!reply.equals("accept") && !reply.equals("decline")) {
            throw new BookingException(HttpStatus.BAD_REQUEST, "BAD_REPLY",
                    "Reply must be accept or decline.");
        }
        return meetings.respond(token, reply.equals("accept"));
    }

    @ExceptionHandler(BookingException.class)
    ResponseEntity<Map<String, String>> handle(BookingException e) {
        return ResponseEntity.status(e.getStatus())
                .body(Map.of("code", e.getCode(), "message", e.getMessage()));
    }
}
