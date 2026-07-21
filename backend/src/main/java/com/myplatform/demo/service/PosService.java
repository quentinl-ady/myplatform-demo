package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.tapi.*;
import com.adyen.service.clouddevice.CloudDeviceApi;
import com.adyen.model.clouddevice.CloudDeviceApiRequest;
import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.myplatform.demo.model.PosPaymentResponse;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

@Service
@Getter
public class PosService {

    private final CloudDeviceApi cloudDeviceApi;
    private final String saleId;
    private final String merchantAccount;

    public PosService(@Qualifier("pspClient") Client pspClient,
                      @Value("${adyen.saleId:POS_SYSTEM_MYPLATFORM}") String saleId,
                      @Value("${adyen.merchantAccount}") String merchantAccount) {
        this.saleId = saleId;
        this.merchantAccount = merchantAccount;
        this.cloudDeviceApi = new CloudDeviceApi(pspClient);
    }

    public CloudDeviceApiResponse initiateSyncPayment(String reference, Long minorUnitAmount, String currency, String terminalId) throws Exception {

        BigDecimal majorUnitAmount = BigDecimal.valueOf(minorUnitAmount).movePointLeft(2);

        CloudDeviceApiRequest apiRequest = new CloudDeviceApiRequest();
        SaleToPOIRequest saleToPOIRequest = new SaleToPOIRequest();

        String serviceId = UUID.randomUUID().toString().replace("-", "").substring(0, 9);

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
                .timeStamp(OffsetDateTime.now(ZoneOffset.UTC));
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
