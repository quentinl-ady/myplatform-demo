package com.myplatform.demo.dto;

import com.myplatform.demo.model.CheckoutPayment;
import com.myplatform.demo.model.SplitSettings;
import lombok.Getter;
import lombok.Setter;

/** Optional checkout settings. Leaving the whole object out keeps the default behaviour. */
@Getter
@Setter
public class AdvancedPaymentOptions {
    /** Defaults to IMMEDIATE. */
    private CheckoutPayment.CaptureMode captureMode;
    /** Hours between the authorisation and the automatic capture, for DELAYED. */
    private Integer captureDelayHours;
    /** Replaces the default split (marketplace commission or store split profile) when set. */
    private SplitSettings split;
}
