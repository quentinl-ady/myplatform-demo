package com.myplatform.demo.service;

import com.adyen.model.balanceplatform.Device;
import com.adyen.model.balanceplatform.RegisterSCAFinalResponse;
import com.adyen.model.balanceplatform.RegisterSCAResponse;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.dto.TrustedDeviceDTO;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.model.TrustedDevice;
import com.myplatform.demo.repository.TrustedDeviceRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Trusted devices of a business bank account. Adyen links up to {@value #MAX_DEVICES} SCA devices to a
 * payment instrument, and any of them approves on its own: registering one leaves the others in place.
 */
@Service
public class TrustedDeviceService {

    private static final int MAX_DEVICES = 5;
    private static final String DEVICE_LIMIT_MESSAGE = "This account already has " + MAX_DEVICES
            + " trusted devices, the maximum. Remove one in Trusted devices, then try again.";

    private static final Logger log = LoggerFactory.getLogger(TrustedDeviceService.class);
    private static final Set<String> KINDS = Set.of("phone", "tablet", "computer");
    private static final int MAX_PLATFORM_LENGTH = 60;

    private final TransferService transferService;
    private final BalanceAccountService balanceAccountService;
    private final TrustedDeviceRepository repository;

    public TrustedDeviceService(TransferService transferService,
                                BalanceAccountService balanceAccountService,
                                TrustedDeviceRepository repository) {
        this.transferService = transferService;
        this.balanceAccountService = balanceAccountService;
        this.repository = repository;
    }

    public List<TrustedDeviceDTO> list(String userId, String physicalPi) throws IOException, ApiException {
        List<Device> devices = transferService.getListDevices(physicalPi);
        if (devices == null || devices.isEmpty()) {
            return List.of();
        }
        Map<String, TrustedDevice> records = repository.findByUserId(userId).stream()
                .collect(Collectors.toMap(TrustedDevice::getDeviceId, Function.identity(), (a, b) -> a));
        return devices.stream()
                .map(device -> TrustedDeviceDTO.of(device, records.get(device.getId())))
                .toList();
    }

    /** Refuses a new device once the bank account has as many as Adyen accepts. */
    public void requireRoomForDevice(String physicalPi) throws IOException, ApiException {
        List<Device> devices = transferService.getListDevices(physicalPi);
        if (devices != null && devices.size() >= MAX_DEVICES) {
            throw new ConflictException(DEVICE_LIMIT_MESSAGE);
        }
    }

    /** Starts the registration of a device on the physical bank account. */
    public RegisterSCAResponse initiateRegistration(String physicalPi, String sdkOutput, String deviceName) throws IOException, ApiException {
        requireRoomForDevice(physicalPi);
        try {
            return transferService.registerDevice(sdkOutput, physicalPi, deviceName);
        } catch (ApiException e) {
            if (isDeviceLimit(e)) {
                throw new ConflictException(DEVICE_LIMIT_MESSAGE);
            }
            throw e;
        }
    }

    /** Completes the registration and records the device, which can then be associated with the virtual bank account. */
    public RegisterSCAFinalResponse finalizeRegistration(String userId, String physicalPi, String deviceId, String sdkOutput,
                                                         String kind, String platform) throws IOException, ApiException {
        RegisterSCAFinalResponse response = transferService.finalizeRegistration(deviceId, sdkOutput, physicalPi);
        if (response != null && Boolean.TRUE.equals(response.getSuccess())) {
            TrustedDevice record = new TrustedDevice();
            record.setDeviceId(deviceId);
            record.setUserId(userId);
            record.setKind(normalizeKind(kind));
            record.setPlatform(normalizePlatform(platform));
            repository.save(record);
        }
        return response;
    }

    /** Removes a device from the physical bank account and from the virtual one it was associated with. */
    public void delete(String deviceId, String paymentInstrumentId) throws IOException, ApiException {
        transferService.deleteDevice(deviceId, paymentInstrumentId);

        try {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(paymentInstrumentId);
            if (baId != null) {
                String virtualPi = balanceAccountService.getVirtualBankAccountId(baId);
                if (virtualPi != null) {
                    transferService.deleteDeviceAssociation(deviceId, virtualPi);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to clean up virtual PI association on device delete: {}", e.getMessage());
        }

        repository.findById(deviceId).ifPresent(repository::delete);
    }

    private static boolean isDeviceLimit(ApiException e) {
        if (e.getStatusCode() != 422) {
            return false;
        }
        String text = (e.getResponseBody() + " " + e.getMessage()).toLowerCase(Locale.ROOT);
        return text.contains("limit");
    }

    private static String normalizeKind(String kind) {
        String value = kind != null ? kind.trim().toLowerCase(Locale.ROOT) : null;
        return value != null && KINDS.contains(value) ? value : null;
    }

    private static String normalizePlatform(String platform) {
        if (platform == null || platform.isBlank()) return null;
        String value = platform.trim();
        return value.length() > MAX_PLATFORM_LENGTH ? value.substring(0, MAX_PLATFORM_LENGTH) : value;
    }
}
