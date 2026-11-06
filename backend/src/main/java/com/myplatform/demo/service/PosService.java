package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.tapi.*;
import com.adyen.service.clouddevice.CloudDeviceApi;
import com.adyen.model.clouddevice.CloudDeviceApiAsyncResponse;
import com.adyen.model.clouddevice.CloudDeviceApiRequest;
import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.PosPaymentResponse;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.regex.Pattern;

@Service
@Getter
public class PosService {

    private static final Pattern SERVICE_ID_PATTERN = Pattern.compile("^[A-Za-z0-9]{1,10}$");
    private static final String SERVICE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final CloudDeviceApi cloudDeviceApi;
    private final String saleId;
    private final String merchantAccount;
    private final NetworkTimeService networkTimeService;

    public PosService(@Qualifier("pspClient") Client pspClient,
                      @Value("${adyen.saleId:POS_SYSTEM_MYPLATFORM}") String saleId,
                      @Value("${adyen.merchantAccount}") String merchantAccount,
                      NetworkTimeService networkTimeService) {
        this.saleId = saleId;
        this.merchantAccount = merchantAccount;
        this.cloudDeviceApi = new CloudDeviceApi(pspClient);
        this.networkTimeService = networkTimeService;
    }

    public CloudDeviceApiResponse initiateSyncPayment(String reference, Long minorUnitAmount, String currency, String terminalId, String requestedServiceId) throws Exception {

        String serviceId = requestedServiceId == null || requestedServiceId.isBlank()
                ? randomServiceId()
                : validServiceId(requestedServiceId);

        BigDecimal majorUnitAmount = BigDecimal.valueOf(minorUnitAmount).movePointLeft(2);

        CloudDeviceApiRequest apiRequest = new CloudDeviceApiRequest();
        SaleToPOIRequest saleToPOIRequest = new SaleToPOIRequest();

        MessageHeader messageHeader = new MessageHeader()
                .protocolVersion("3.0")
                .messageType(MessageType.REQUEST)
                .messageClass(MessageClass.SERVICE)
                .messageCategory(MessageCategory.PAYMENT)
                .saleID(this.saleId)
                .serviceID(serviceId);

        saleToPOIRequest.setMessageHeader(messageHeader);

        PaymentRequest paymentRequest = new PaymentRequest();

        SaleData saleData = new SaleData();
        TransactionIDType saleTransactionID = new TransactionIDType()
                .transactionID(reference)
                .timeStamp(networkTimeService.nowUtc());
        saleData.setSaleTransactionID(saleTransactionID);

        paymentRequest.setSaleData(saleData);

        PaymentTransaction paymentTransaction = new PaymentTransaction();
        AmountsReq amountsReq = new AmountsReq()
                .currency(currency)
                .requestedAmount(majorUnitAmount);

        paymentTransaction.setAmountsReq(amountsReq);
        paymentRequest.setPaymentTransaction(paymentTransaction);

        saleToPOIRequest.setPaymentRequest(paymentRequest);
        apiRequest.setSaleToPOIRequest(saleToPOIRequest);

        return this.cloudDeviceApi.sync(this.merchantAccount, terminalId, apiRequest);
    }

    /**
     * Sends a Terminal API AbortRequest for the payment identified by its ServiceID. Abort is fire-and-forget:
     * the terminal answers the pending payment request (Result Failure, ErrorCondition Aborted) instead.
     *
     * @return null when the request was delivered, otherwise a message explaining why it was rejected
     */
    public String abortPayment(String terminalId, String paymentServiceId) throws Exception {
        if (terminalId == null || terminalId.isBlank()) {
            throw new BadRequestException("Enter the ID of the terminal that runs the payment.");
        }
        if (paymentServiceId == null || paymentServiceId.isBlank()) {
            throw new BadRequestException("Enter the service ID of the payment to cancel.");
        }
        String targetServiceId = validServiceId(paymentServiceId);

        String abortServiceId = randomServiceId();
        while (abortServiceId.equals(targetServiceId)) {
            abortServiceId = randomServiceId();
        }

        MessageHeader messageHeader = new MessageHeader()
                .protocolVersion("3.0")
                .messageType(MessageType.REQUEST)
                .messageClass(MessageClass.SERVICE)
                .messageCategory(MessageCategory.ABORT)
                .saleID(this.saleId)
                .serviceID(abortServiceId)
                .POIID(terminalId);

        MessageReference messageReference = new MessageReference()
                .messageCategory(MessageCategory.PAYMENT)
                .serviceID(targetServiceId)
                .saleID(this.saleId)
                .POIID(terminalId);

        AbortRequest abortRequest = new AbortRequest()
                .messageReference(messageReference)
                .abortReason("MerchantAbort");

        SaleToPOIRequest saleToPOIRequest = new SaleToPOIRequest()
                .messageHeader(messageHeader)
                .abortRequest(abortRequest);

        CloudDeviceApiRequest apiRequest = new CloudDeviceApiRequest();
        apiRequest.setSaleToPOIRequest(saleToPOIRequest);

        CloudDeviceApiAsyncResponse asyncResponse = this.cloudDeviceApi.async(this.merchantAccount, terminalId, apiRequest);
        if (asyncResponse != null && "ok".equalsIgnoreCase(asyncResponse.getResult())) {
            return null;
        }
        return abortRejection(asyncResponse);
    }

    private String abortRejection(CloudDeviceApiAsyncResponse asyncResponse) {
        String fallback = "The terminal did not accept the cancel request.";
        if (asyncResponse == null || asyncResponse.getSaleToPOIRequest() == null
                || asyncResponse.getSaleToPOIRequest().getEventNotification() == null) {
            return fallback;
        }
        String details = asyncResponse.getSaleToPOIRequest().getEventNotification().getEventDetails();
        if (details == null || details.isBlank()) {
            return fallback;
        }
        // EventDetails is URL-encoded key/value pairs, for example "message=Device+busy".
        for (String pair : details.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && "message".equals(pair.substring(0, eq))) {
                return fallback + " " + URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return fallback;
    }

    private static String validServiceId(String serviceId) {
        if (!SERVICE_ID_PATTERN.matcher(serviceId).matches()) {
            throw new BadRequestException("The service ID must be 1 to 10 letters or digits.");
        }
        return serviceId;
    }

    private static String randomServiceId() {
        StringBuilder id = new StringBuilder(10);
        for (int i = 0; i < 10; i++) {
            id.append(SERVICE_ID_ALPHABET.charAt(RANDOM.nextInt(SERVICE_ID_ALPHABET.length())));
        }
        return id.toString();
    }

    public PosPaymentResponse mapTerminalResponse(CloudDeviceApiResponse cloudDeviceApiResponse) {
        PosPaymentResponse response = new PosPaymentResponse();

        if (cloudDeviceApiResponse == null || cloudDeviceApiResponse.getSaleToPOIResponse() == null) {
            response.setStatus("ERROR");
            response.setRefusalReason("Empty or invalid response from terminal");
            return response;
        }

        PaymentResponse paymentResponse = cloudDeviceApiResponse.getSaleToPOIResponse().getPaymentResponse();

        if (paymentResponse != null && paymentResponse.getResponse() != null) {
            Result result = paymentResponse.getResponse().getResult();

            if (result == Result.SUCCESS) {
                response.setStatus("SUCCESS");

                if (paymentResponse.getPoiData() != null && paymentResponse.getPoiData().getPoITransactionID() != null) {
                    String fullTransactionId = paymentResponse.getPoiData().getPoITransactionID().getTransactionID();

                    if (fullTransactionId != null && fullTransactionId.contains(".")) {
                        response.setPspReference(fullTransactionId.substring(fullTransactionId.indexOf('.') + 1));
                    } else {
                        response.setPspReference(fullTransactionId);
                    }
                }

                if(paymentResponse.getSaleData() != null && paymentResponse.getSaleData().getSaleTransactionID() != null){
                    response.setReference(paymentResponse.getSaleData().getSaleTransactionID().getTransactionID());
                }

                if (paymentResponse.getPaymentResult() != null && paymentResponse.getPaymentResult().getPaymentInstrumentData() != null) {
                    response.setCardBrand(paymentResponse.getPaymentResult().getPaymentInstrumentData().getCardData().getPaymentBrand());
                    response.setMaskedPan(paymentResponse.getPaymentResult().getPaymentInstrumentData().getCardData().getMaskedPan());
                }
            } else {
                response.setStatus("FAILURE");

                if (paymentResponse.getResponse().getErrorCondition() != null) {
                    response.setErrorCondition(paymentResponse.getResponse().getErrorCondition().getValue());
                }
                response.setRefusalReason(paymentResponse.getResponse().getAdditionalResponse());
            }
        } else {
            response.setStatus("ERROR");
            response.setRefusalReason("Missing payment response details in Nexo payload");
        }

        return response;
    }
}
