package com.myplatform.demo.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class PhonePrefix {
    private String code;
    private String country;
    private String flag;
}
