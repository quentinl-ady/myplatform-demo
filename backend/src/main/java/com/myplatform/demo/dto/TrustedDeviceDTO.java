package com.myplatform.demo.dto;

import com.adyen.model.balanceplatform.Device;
import com.myplatform.demo.model.TrustedDevice;

/**
 * An SCA device registered on Adyen, with what the platform recorded when it was registered.
 *
 * @param kind         phone, tablet or computer; null for devices registered before it was recorded
 * @param platform     e.g. "iPhone · Safari"; null when unknown
 * @param registeredAt ISO-8601 UTC timestamp; null when unknown
 */
public record TrustedDeviceDTO(String id,
                               String name,
                               String paymentInstrumentId,
                               String type,
                               String kind,
                               String platform,
                               String registeredAt) {

    public static TrustedDeviceDTO of(Device device, TrustedDevice record) {
        return new TrustedDeviceDTO(
                device.getId(),
                device.getName(),
                device.getPaymentInstrumentId(),
                device.getType() != null ? device.getType().getValue() : null,
                record != null ? record.getKind() : null,
                record != null ? record.getPlatform() : null,
                record != null && record.getCreatedAt() != null ? record.getCreatedAt().toString() : null
        );
    }
}
