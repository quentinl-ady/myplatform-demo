package com.myplatform.demo.model;

import lombok.*;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class Status {
    private Boolean allowed;
    private String verificationStatus; //pending valid invalid rejected

}
