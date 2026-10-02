package com.seatbooking.meeting;

import com.seatbooking.domain.EmailOutbox;
import com.seatbooking.repo.EmailOutboxRepository;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transactional half of the outbox.
 *
 * <p>A separate bean from {@link OutboxWorker} on purpose. Spring's {@code @Transactional}
 * is applied by a proxy, so a scheduled method calling a transactional method on
 * {@code this} gets no transaction at all: the claim would run in autocommit, its row
 * locks would be released immediately, and two workers would happily send the same
 * invitation twice. Going through an injected bean means the call actually crosses the
 * proxy.
 */
@Component
public class OutboxDelivery {

    private static final Logger log = LoggerFactory.getLogger(OutboxDelivery.class);

    /**
     * How long a claimed row is considered someone else's.
     *
     * <p>Row locks last only as long as the claiming transaction, so the claim also
     * pushes {@code next_attempt_at} forward. That is the actual lease: if this worker
     * dies mid-send the row becomes due again a minute later, and until then no other
     * worker will pick it up.
     */
    private static final String LEASE = "1 minute";

    private final EmailOutboxRepository outbox;
    private final JavaMailSender mailSender;
    private final MailProperties properties;
    private final JdbcClient jdbc;

    public OutboxDelivery(EmailOutboxRepository outbox, JavaMailSender mailSender,
                          MailProperties properties, JdbcClient jdbc) {
        this.outbox = outbox;
        this.mailSender = mailSender;
        this.properties = properties;
        this.jdbc = jdbc;
    }

    /** Take a batch of due rows and lease them, so no other worker sends them too. */
    @Transactional
    public List<UUID> claim() {
        List<UUID> ids = jdbc.sql("""
                SELECT id FROM email_outbox
                WHERE status = 'PENDING' AND next_attempt_at <= now()
                ORDER BY next_attempt_at
                LIMIT :batch
                FOR UPDATE SKIP LOCKED
                """)
                .param("batch", properties.batchSize())
                .query(UUID.class)
                .list();

        if (!ids.isEmpty()) {
            jdbc.sql("UPDATE email_outbox SET next_attempt_at = now() + interval '" + LEASE + "' "
                            + "WHERE id IN (:ids)")
                    .param("ids", ids)
                    .update();
        }
        return ids;
    }

    /**
     * One message, in its own transaction, so a single bad address cannot roll back the
     * batch and the attempt count is recorded even when the send throws.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void deliver(UUID id) {
        EmailOutbox row = outbox.findById(id).orElse(null);
        if (row == null || row.getStatus() != EmailOutbox.Status.PENDING) {
            return;
        }
        try {
            mailSender.send(buildMessage(row));
            row.markSent(Instant.now());
            log.debug("Sent outbox message {} to {}", id, row.getRecipient());
        } catch (Exception e) {
            row.markFailed(e.getMessage(), Instant.now());
            if (row.getStatus() == EmailOutbox.Status.FAILED) {
                log.error("Giving up on outbox message {} to {} after {} attempts",
                        id, row.getRecipient(), row.getAttempts(), e);
            } else {
                log.warn("Outbox message {} to {} failed (attempt {}), retrying at {}",
                        id, row.getRecipient(), row.getAttempts(), row.getNextAttemptAt());
            }
        }
        // Written with explicit SQL rather than a JPA dirty check. Hibernate flushes the
        // update at COMMIT, after any try/catch here has exited, and throws if the row has
        // since been deleted; the exception then escapes the scheduled task entirely. An
        // UPDATE that simply affects no rows says the same thing without the drama.
        int updated = jdbc.sql("""
                UPDATE email_outbox
                SET status = :status, attempts = :attempts, last_error = :lastError,
                    next_attempt_at = :nextAttemptAt, sent_at = :sentAt
                WHERE id = :id
                """)
                .param("status", row.getStatus().name())
                .param("attempts", row.getAttempts())
                .param("lastError", row.getLastError())
                .param("nextAttemptAt", java.sql.Timestamp.from(row.getNextAttemptAt()))
                .param("sentAt", row.getSentAt() == null ? null : java.sql.Timestamp.from(row.getSentAt()))
                .param("id", id)
                .update();
        if (updated == 0) {
            log.debug("Outbox row {} disappeared while being delivered", id);
        }
    }

    private MimeMessage buildMessage(EmailOutbox row) throws Exception {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
        helper.setFrom(properties.from());
        helper.setTo(row.getRecipient());
        helper.setSubject(row.getSubject());
        helper.setText(row.getBody(), true);
        if (row.getIcs() != null && !row.getIcs().isBlank()) {
            // text/calendar with METHOD=REQUEST is what makes a mail client show the
            // invitation inline with Accept and Decline rather than a file to download.
            helper.addAttachment("invite.ics",
                    new ByteArrayResource(row.getIcs().getBytes(StandardCharsets.UTF_8)),
                    "text/calendar; method=REQUEST; charset=UTF-8");
        }
        return message;
    }
}
