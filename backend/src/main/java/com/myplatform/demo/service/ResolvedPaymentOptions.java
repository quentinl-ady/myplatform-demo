package com.myplatform.demo.service;

import com.adyen.model.checkout.CreateCheckoutSessionRequest;
import com.adyen.model.checkout.PaymentRequest;
import com.adyen.model.checkout.Split;
import com.myplatform.demo.model.CheckoutPayment;
import com.myplatform.demo.model.SplitSettings;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Checkout options of one payment, turned into Adyen request fields by CheckoutPaymentService.resolve.
 *
 * @param explicit   the client sent advanced options (otherwise the defaults apply)
 * @param splits     null when the store split profile applies or there is no split
 * @param trackingId id of the CheckoutPayment to record, null for immediate capture
 */
public record ResolvedPaymentOptions(
        Target target,
        String reference,
        long amount,
        String currency,
        boolean explicit,
        CheckoutPayment.CaptureMode captureMode,
        Integer captureDelayHours,
        CheckoutPayment.SplitMode splitMode,
        SplitSettings splitSettings,
        List<Split> splits,
        String trackingId) {

    /**
     * @param source           PaymentResultRedirects.SOURCE_CHECKOUT or SOURCE_ISSUING_CHECKOUT
     * @param ownerUserId      user whose Captures page lists the payment
     * @param subMerchantUserId user whose balance account receives the funds
     * @param storeReference   store of an embedded payment, null otherwise
     */
    public record Target(String source, String merchantAccount, String ownerUserId, String subMerchantUserId,
                         String activityReason, String balanceAccountId, String storeReference) {
    }

    public boolean tracked() {
        return trackingId != null;
    }

    public void applyTo(CreateCheckoutSessionRequest request) {
        if (splits != null) {
            request.setSplits(splits);
        }
        switch (captureMode) {
            case IMMEDIATE -> request.setCaptureDelayHours(0);
            case DELAYED -> request.setCaptureDelayHours(captureDelayHours);
            case MANUAL -> request.setAdditionalData(manualCaptureData());
        }
    }

    public void applyTo(PaymentRequest request) {
        if (splits != null) {
            request.setSplits(splits);
        }
        switch (captureMode) {
            // Without advanced options, token payments keep the capture delay of the merchant account.
            case IMMEDIATE -> {
                if (explicit) {
                    request.setCaptureDelayHours(0);
                }
            }
            case DELAYED -> request.setCaptureDelayHours(captureDelayHours);
            case MANUAL -> request.setAdditionalData(manualCaptureData());
        }
    }

    // captureDelayHours must not be sent with manualCapture: Adyen refuses the payment (Invalid additional data).
    private static Map<String, String> manualCaptureData() {
        Map<String, String> additionalData = new HashMap<>();
        additionalData.put("manualCapture", "true");
        return additionalData;
    }
}
