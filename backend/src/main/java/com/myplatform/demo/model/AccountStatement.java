package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * A CAMT.053 statement that Adyen generated for a business account, announced by the
 * balancePlatform.report.created webhook. The file stays at Adyen until a user downloads it.
 */
@Entity
@Table(name = "account_statement")
@Getter
@Setter
public class AccountStatement {

    /** One per balance account, period and currency, e.g. CAMT053_BA..._20261019010000_20261020005959_EUR.xml */
    @Id
    @Column(length = 200)
    private String fileName;

    @Column(nullable = false, length = 100)
    private String accountHolderId;

    @Column(nullable = false, length = 100)
    private String balanceAccountId;

    @Column(nullable = false, length = 1000)
    private String downloadUrl;

    /** When Adyen generated the statement. */
    @Column(nullable = false)
    private Instant creationDate;

    @Column(nullable = false)
    private Instant receivedAt;

    @PrePersist
    public void prePersist() {
        if (this.receivedAt == null) {
            this.receivedAt = Instant.now();
        }
    }
}
