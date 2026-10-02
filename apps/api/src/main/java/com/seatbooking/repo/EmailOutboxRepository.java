package com.seatbooking.repo;

import com.seatbooking.domain.EmailOutbox;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EmailOutboxRepository extends JpaRepository<EmailOutbox, UUID> {}
