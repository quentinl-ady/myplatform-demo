package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

/**
 * What the platform knows about an SCA device registered on Adyen: the Adyen device itself only
 * has a name and the type "browser", whatever the browser runs on.
 */
@Entity
@Table(name = "trusted_device")
@Getter
@Setter
public class TrustedDevice {

    @Id
    @Column(length = 100)
    private String deviceId;

    @Column(nullable = false, length = 10)
    private String userId;

    /** phone, tablet or computer */
    @Column(length = 20)
    private String kind;

    /** e.g. "iPhone · Safari" */
    @Column(length = 60)
    private String platform;

    @Column(nullable = false)
    private Instant createdAt;

    @PrePersist
    public void prePersist() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }
}
