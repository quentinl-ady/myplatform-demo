package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.nexo.*;
import com.adyen.service.TerminalCloudAPI;
import com.myplatform.demo.model.PosPaymentResponse;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.adyen.model.terminal.TerminalAPIRequest;
import com.adyen.model.terminal.TerminalAPIResponse;

import javax.xml.datatype.DatatypeFactory;
import javax.xml.datatype.XMLGregorianCalendar;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.GregorianCalendar;
import java.util.UUID;

@Service
@Getter
public class PosService {

    private final TerminalCloudAPI terminalCloudAPI;
    private final String saleId;

    public PosService(@Qualifier("pspClient") Client pspClient,
                      @Value("${adyen.saleId:POS_SYSTEM_MYPLATFORM}") String saleId) {
        this.saleId = saleId;
        this.terminalCloudAPI = new TerminalCloudAPI(pspClient);
    }

    public TerminalAPIResponse initiateSyncPayment(String reference, Long minorUnitAmount, String currency, String terminalId) throws Exception {

        BigDecimal majorUnitAmount = BigDecimal.valueOf(minorUnitAmount).movePointLeft(2);

        TerminalAPIRequest apiRequest = new TerminalAPIRequest();
        SaleToPOIRequest saleToPOIRequest = new SaleToPOIRequest();

        MessageHeader messageHeader = new MessageHeader();
        messageHeader.setProtocolVersion("3.0");
        messageHeader.setMessageType(MessageType.REQUEST);
        messageHeader.setMessageClass(MessageClassType.SERVICE);
        messageHeader.setMessageCategory(MessageCategoryType.PAYMENT);
        messageHeader.setSaleID(this.saleId);
        messageHeader.setPOIID(terminalId);
        String serviceId = UUID.randomUUID().toString().replace("-", "").substring(0, 9);
        messageHeader.setServiceID(serviceId);

        saleToPOIRequest.setMessageHeader(messageHeader);

        PaymentRequest paymentRequest = new PaymentRequest();

        SaleData saleData = new SaleData();
        TransactionIdentification saleTransactionID = new TransactionIdentification();
        saleTransactionID.setTransactionID(reference);
        GregorianCalendar gregorianCalendar = GregorianCalendar.from(ZonedDateTime.now());
        XMLGregorianCalendar timeStamp = DatatypeFactory.newInstance().newXMLGregorianCalendar(gregorianCalendar);
        saleTransactionID.setTimeStamp(timeStamp);
        saleData.setSaleTransactionID(saleTransactionID);

        paymentRequest.setSaleData(saleData);

        PaymentTransaction paymentTransaction = new PaymentTransaction();
        AmountsReq amountsReq = new AmountsReq();
        amountsReq.setCurrency(currency);
        amountsReq.setRequestedAmount(majorUnitAmount);

        paymentTransaction.setAmountsReq(amountsReq);
        paymentRequest.setPaymentTransaction(paymentTransaction);

        saleToPOIRequest.setPaymentRequest(paymentRequest);
        apiRequest.setSaleToPOIRequest(saleToPOIRequest);

        return this.terminalCloudAPI.sync(apiRequest);
    }

    public PosPaymentResponse mapTerminalResponse(TerminalAPIResponse terminalApiResponse) {
        PosPaymentResponse response = new PosPaymentResponse();

        if (terminalApiResponse == null || terminalApiResponse.getSaleToPOIResponse() == null) {
            response.setStatus("ERROR");
            response.setRefusalReason("Empty or invalid response from terminal");
            return response;
        }

        PaymentResponse paymentResponse = terminalApiResponse.getSaleToPOIResponse().getPaymentResponse();

        if (paymentResponse != null && paymentResponse.getResponse() != null) {
            ResultType result = paymentResponse.getResponse().getResult();

            if (result == ResultType.SUCCESS) {
                response.setStatus("SUCCESS");

                if (paymentResponse.getPOIData() != null && paymentResponse.getPOIData().getPOITransactionID() != null) {
                    String fullTransactionId = paymentResponse.getPOIData().getPOITransactionID().getTransactionID();

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
                    response.setMaskedPan(paymentResponse.getPaymentResult().getPaymentInstrumentData().getCardData().getMaskedPAN());
                }
            } else {
                response.setStatus("FAILURE");

                if (paymentResponse.getResponse().getErrorCondition() != null) {
                    response.setErrorCondition(paymentResponse.getResponse().getErrorCondition().value());
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
