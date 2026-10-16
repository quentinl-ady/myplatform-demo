package com.myplatform.demo.dto;

import com.myplatform.demo.model.SplitSettings;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class CaptureRequest {
    private String userId;
    /** Minor units. Null captures the whole remaining amount. */
    private Long amount;
    /** Split for this capture only. Null reuses the split of the payment. */
    private SplitSettings split;
}
