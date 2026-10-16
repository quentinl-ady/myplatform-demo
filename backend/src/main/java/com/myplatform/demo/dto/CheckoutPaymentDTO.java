package com.myplatform.demo.dto;

import com.myplatform.demo.model.CheckoutPayment;
import com.myplatform.demo.model.CheckoutPaymentOperation;
import com.myplatform.demo.model.SplitSettings;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.List;

@Getter
@Setter
public class CheckoutPaymentDTO {

    public enum State {
        PENDING_AUTHORISATION,
        AWAITING_CAPTURE,
        /** Delayed automatic capture that hasn't happened yet. */
        CAPTURE_SCHEDULED,
        CAPTURE_SUBMITTED,
        PARTIALLY_CAPTURED,
        CAPTURED,
        /** The delayed automatic capture time has passed. */
        AUTO_CAPTURED,
        CANCEL_SUBMITTED,
        CANCELLED,
        NOT_AUTHORISED
    }

    private String id;
    private String source;
    private CheckoutPayment.Channel channel;
    private String merchantReference;
    private String pspReference;
    private String storeReference;
    private String balanceAccountId;
    private Long amount;
    private String currency;
    private CheckoutPayment.Status status;
    private State state;
    private String refusalReason;
    private CheckoutPayment.CaptureMode captureMode;
    private Integer captureDelayHours;
    private Instant scheduledCaptureAt;
    /** Captures confirmed by a CAPTURE webhook. */
    private long capturedAmount;
    /** Captures accepted by Adyen and waiting for the CAPTURE webhook. */
    private long pendingCaptureAmount;
    private long remainingAmount;
    /** Rest of the amount released by Adyen after a partial capture. */
    private long releasedAmount;
    private boolean canCapture;
    private boolean canCancel;
    private CheckoutPayment.SplitMode splitMode;
    private SplitSettings splitSettings;
    /** Split instructions sent with the authorisation. */
    private List<SplitLine> splits;
    private Instant createdAt;
    private Instant authorisedAt;
    private List<Operation> operations;

    @Getter
    @Setter
    public static class Operation {
        private Long id;
        private CheckoutPaymentOperation.Type type;
        private CheckoutPaymentOperation.Status status;
        private CheckoutPaymentOperation.Origin origin;
        private Long amount;
        private String reference;
        private String pspReference;
        private String reason;
        private List<SplitLine> splits;
        private Instant createdAt;
        private Instant updatedAt;
    }
}
