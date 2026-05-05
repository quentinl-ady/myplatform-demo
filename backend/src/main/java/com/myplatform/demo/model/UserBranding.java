package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "user_branding")
@Getter
@Setter
public class UserBranding {

    @Id
    @Column(length = 10)
    private String userId;

    @Column(length = 100)
    private String platformName;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String logoData;

    @Column(length = 20)
    private String logoType;
}
