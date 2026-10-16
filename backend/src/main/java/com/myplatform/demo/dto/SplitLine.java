package com.myplatform.demo.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** One split instruction sent to Adyen. Amount is null for fee splits. */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class SplitLine {
    private String type;
    private String account;
    private Long amount;
    private String reference;
}
