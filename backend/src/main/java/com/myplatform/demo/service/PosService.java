package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.tapi.*;
import com.adyen.service.clouddevice.CloudDeviceApi;
import com.adyen.model.clouddevice.CloudDeviceApiAsyncResponse;
import com.adyen.model.clouddevice.CloudDeviceApiRequest;
import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.adyen.service.exception.ApiException;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.PosPaymentResponse;
import com.myplatform.demo.util.InvoiceTerminalRules;
import com.myplatform.demo.util.TerminalOutcome;
import com.myplatform.demo.util.TerminalResponses;
import lombok.Getter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.ZoneOffset;
import java.util.Currency;
import java.util.regex.Pattern;

@Service
@Getter
public class PosService {

    private static final Logger log = LoggerFactory.getLogger(PosService.class);
    private static final Pattern SERVICE_ID_PATTERN = Pattern.compile("^[A-Za-z0-9]{1,10}$");
    private static final String SERVICE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final CloudDeviceApi cloudDeviceApi;
    private final String saleId;
    private final String merchantAccount;
    private final NetworkTimeService networkTimeService;

    public PosService(@Qualifier("terminalClient") Client terminalClient,
                      @Value("${adyen.saleId:POS_SYSTEM_MYPLATFORM}") String saleId,
                      @Value("${adyen.merchantAccount}") String merchantAccount,
                      NetworkTimeService networkTimeService) {
        this.saleId = saleId;
        this.merchantAccount = merchantAccount;
        this.cloudDeviceApi = new CloudDeviceApi(terminalClient);
        this.networkTimeService = networkTimeService;
    }

    /**
     * Asks the terminal to take a payment, and waits for its answer. A request that failed, or whose answer was lost,
     * is an outcome too.
     *
     * @param serviceId identifies the payment, to cancel it with {@link #abortPayment}
     * @param reference the merchant reference of the payment: its webhooks carry it
     * @param amount    in minor units
     */
    public TerminalOutcome pay(String terminalId, String serviceId, String reference, long amount, String currency) {
        PaymentRequest paymentRequest = new PaymentRequest()
                .saleData(new SaleData().saleTransactionID(new TransactionIDType()
                        .transactionID(reference)
                        .timeStamp(networkTimeService.nowUtc())))
                .paymentTransaction(new PaymentTransaction().amountsReq(new AmountsReq()
                        .currency(currency)
                        .requestedAmount(majorUnits(amount, currency))));
        SaleToPOIRequest request = new SaleToPOIRequest()
                .messageHeader(header(MessageCategory.PAYMENT, serviceId))
                .paymentRequest(paymentRequest);
        try {
            return TerminalResponses.payment(sync(terminalId, request));
        } catch (ApiException e) {
            log.warn("Payment {} at terminal {} rejected: {} {}", reference, terminalId, e.getStatusCode(), e.getMessage());
            return TerminalResponses.failure(e);
        } catch (IOException e) {
            log.warn("Payment {} at terminal {}: no answer ({})", reference, terminalId, e.toString());
            return TerminalResponses.lost(e);
        }
    }

    /**
     * Asks the terminal to refund a payment, and waits for its answer: Adyen confirms the refund later, with a webhook.
     *
     * @param reference the merchant reference of the refund
     * @param amount    in minor units: less than the payment for a partial refund
     */
    public TerminalOutcome reverse(String terminalId, String serviceId, String reference,
                                   InvoiceTerminalRules.OriginalTransaction original, long amount, String currency) {
        SaleData saleData = new SaleData().saleTransactionID(new TransactionIDType()
                .transactionID(reference)
                .timeStamp(networkTimeService.nowUtc()));
        if (!original.atTerminal()) {
            // The terminal knows the currency of its own payments only.
            saleData.saleToAcquirerData("currency=" + currency);
        }
        ReversalRequest reversalRequest = new ReversalRequest()
                .saleData(saleData)
                .originalPOITransaction(new OriginalPOITransaction().poITransactionID(new TransactionIDType()
                        .transactionID(original.transactionId())
                        .timeStamp(original.at().atOffset(ZoneOffset.UTC))))
                .reversedAmount(majorUnits(amount, currency))
                .reversalReason(ReversalReason.MERCHANT_CANCEL);
        SaleToPOIRequest request = new SaleToPOIRequest()
                .messageHeader(header(MessageCategory.REVERSAL, serviceId))
                .reversalRequest(reversalRequest);
        try {
            return TerminalResponses.reversal(sync(terminalId, request));
        } catch (ApiException e) {
            log.warn("Refund {} at terminal {} rejected: {} {}", reference, terminalId, e.getStatusCode(), e.getMessage());
            return TerminalResponses.failure(e);
        } catch (IOException e) {
            log.warn("Refund {} at terminal {}: no answer ({})", reference, terminalId, e.toString());
            return TerminalResponses.lost(e);
        }
    }

    private CloudDeviceApiResponse sync(String terminalId, SaleToPOIRequest request) throws ApiException, IOException {
        CloudDeviceApiRequest apiRequest = new CloudDeviceApiRequest();
        apiRequest.setSaleToPOIRequest(request);
        return this.cloudDeviceApi.sync(this.merchantAccount, terminalId, apiRequest);
    }

    private MessageHeader header(MessageCategory category, String serviceId) {
        return new MessageHeader()
                .protocolVersion("3.0")
                .messageType(MessageType.REQUEST)
                .messageClass(MessageClass.SERVICE)
                .messageCategory(category)
                .saleID(this.saleId)
                .serviceID(validServiceId(serviceId));
    }

    /** The amount the Terminal API expects: in major units, with the decimals of the currency. */
    static BigDecimal majorUnits(long minorUnits, String currency) {
        int digits;
        try {
            digits = Math.max(Currency.getInstance(currency).getDefaultFractionDigits(), 0);
        } catch (IllegalArgumentException | NullPointerException e) {
            digits = 2;
        }
        return BigDecimal.valueOf(minorUnits, digits);
    }

    public CloudDeviceApiResponse initiateSyncPayment(String reference, Long minorUnitAmount, String currency, String terminalId, String requestedServiceId) throws Exception {

        String serviceId = requestedServiceId == null || requestedServiceId.isBlank()
                ? newServiceId()
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
    public String abortPayment(String terminalId, String paymentServiceId) throws IOException, ApiException {
        if (terminalId == null || terminalId.isBlank()) {
            throw new BadRequestException("Enter the ID of the terminal that runs the payment.");
        }
        if (paymentServiceId == null || paymentServiceId.isBlank()) {
            throw new BadRequestException("Enter the service ID of the payment to cancel.");
        }
        String targetServiceId = validServiceId(paymentServiceId);

        String abortServiceId = newServiceId();
        while (abortServiceId.equals(targetServiceId)) {
            abortServiceId = newServiceId();
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

    /** A ServiceID identifies a request to a terminal: 10 random letters and digits. */
    public static String newServiceId() {
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

                // A payment with a wallet or another instrument has no CardData.
                CardData cardData = paymentResponse.getPaymentResult() != null
                        && paymentResponse.getPaymentResult().getPaymentInstrumentData() != null
                        ? paymentResponse.getPaymentResult().getPaymentInstrumentData().getCardData()
                        : null;
                if (cardData != null) {
                    response.setCardBrand(cardData.getPaymentBrand());
                    response.setMaskedPan(cardData.getMaskedPan());
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
