ALTER TABLE tickets
    MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'VALID';

CREATE TABLE IF NOT EXISTS ticket_transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ticket_id BIGINT UNSIGNED NOT NULL,
    sender_user_id BIGINT UNSIGNED NOT NULL,
    recipient_user_id BIGINT UNSIGNED NOT NULL,
    status ENUM('PENDING', 'COMPLETED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_ticket_transfers_ticket_status (ticket_id, status),
    KEY idx_ticket_transfers_recipient_status (recipient_user_id, status)
) ENGINE=InnoDB;
