package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Getter
@Setter
public class WebhookEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String eventType;

    private String webhookType;

    @Column(columnDefinition = "TEXT")
    private String rawJson;

    private String resourceId;

    private String title;

    private String description;

    private String userId;

    private boolean acknowledged;

    private LocalDateTime receivedAt;

    private String source;

    @PrePersist
    public void prePersist() {
        if (receivedAt == null) {
            receivedAt = LocalDateTime.now();
        }
    }
}
