package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.adyen.model.balanceplatform.PublicKeyResponse;
import com.adyen.model.balanceplatform.RevealPinRequest;
import com.adyen.service.balanceplatform.ManageCardPinApi;
import com.adyen.service.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;

@Service
public class IssuingService {

    private final ManageCardPinApi manageCardPinApi;

    public IssuingService(@Value("${adyen.balancePlatformApiKey}") String balancePlatformApiKey) {
        Client balancePlatformClient = new Client(balancePlatformApiKey, Environment.TEST);
        manageCardPinApi = new ManageCardPinApi(balancePlatformClient);
    }


    public String getPublicKey(String reason) throws IOException, ApiException {
        PublicKeyResponse publicKeyResponse = manageCardPinApi.publicKey(reason, "pem", null);
        //PublicKeyResponse publicKeyResponse = manageCardPinApi.publicKey("panReveal","pem", null);
        return publicKeyResponse.getPublicKey();
    }

    public String getCardData(String encryptedKey, String paymentInstrumentId, String reason) throws IOException, ApiException {

        if ("revealPin".equals(reason)){
            manageCardPinApi.revealCardPin(new RevealPinRequest()
                    .encryptedKey(encryptedKey)
                    .paymentInstrumentId(paymentInstrumentId));
        } else if ("revealPan".equals(reason)){
            return null;
        }

        return null;
    }
}
