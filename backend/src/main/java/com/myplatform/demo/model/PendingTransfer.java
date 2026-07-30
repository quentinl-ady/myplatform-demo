package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Entity
@Table(name = "pending_transfer")
@Getter
@Setter
public class PendingTransfer {

    @Id
    @Column(length = 100)
    private String transferId;

    @Column(nullable = false)
    private String accountHolderId;

    @Column(nullable = false)
    private Instant createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }
}
