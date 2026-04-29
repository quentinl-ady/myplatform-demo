package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.legalentitymanagement.BusinessLineInfo;
import com.adyen.service.balanceplatform.AccountHoldersApi;
import com.adyen.service.exception.ApiException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@Service
public class AccountHolderService {

    private final AccountHoldersApi accountHoldersApi;
    private final BankingProvisioningService bankingProvisioningService;

    public AccountHolderService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                                BankingProvisioningService bankingProvisioningService) {
        this.accountHoldersApi = new AccountHoldersApi(balancePlatformClient);
        this.bankingProvisioningService = bankingProvisioningService;
    }

    public String createAccountHolder(String legalEntityId, String activityReason, Boolean capital, Boolean bank, Boolean issuing,
                                      String firstName, String lastName, String legalName, String userType) throws IOException, ApiException {
        String reference = getReference(firstName, lastName, legalName, userType);

        AccountHolderInfo accountHolderInfo = new AccountHolderInfo()
                .legalEntityId(legalEntityId)
                .reference(reference);

        Map<String, AccountHolderCapability> capabilities = new HashMap<>(Map.of(
                "receiveFromBalanceAccount", new AccountHolderCapability().enabled(true).requested(true),
                "sendToBalanceAccount", new AccountHolderCapability().enabled(true).requested(true),
                "sendToTransferInstrument", new AccountHolderCapability().enabled(true).requested(true),
                "receiveFromPlatformPayments", new AccountHolderCapability().enabled(true).requested(true)
        ));

        if (activityReason.equals("marketplace")) {
            capabilities.put("receivePayments", new AccountHolderCapability().enabled(false).requested(false));
        } else {
            capabilities.put("receivePayments", new AccountHolderCapability().enabled(true).requested(true));
        }

        if (capital) {
            capabilities.put("receiveGrants", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("getGrantOffers", new AccountHolderCapability().enabled(true).requested(true));
        } else {
            capabilities.put("receiveGrants", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("getGrantOffers", new AccountHolderCapability().enabled(false).requested(false));
        }

        if (bank) {
            capabilities.put("issueBankAccount", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("sendToThirdParty", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("receiveFromThirdParty", new AccountHolderCapability().enabled(true).requested(true));
            bankingProvisioningService.createBusinessLine(legalEntityId, BusinessLineInfo.ServiceEnum.BANKING);
        } else {
            capabilities.put("issueBankAccount", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("sendToThirdParty", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("receiveFromThirdParty", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("receiveFromTransferInstrument", new AccountHolderCapability().enabled(false).requested(false));
        }

        if (issuing) {
            capabilities.put("issueCard", new AccountHolderCapability().enabled(true).requested(true));
            capabilities.put("useCard", new AccountHolderCapability().enabled(true).requested(true));
            bankingProvisioningService.createBusinessLine(legalEntityId, BusinessLineInfo.ServiceEnum.ISSUING);
        } else {
            capabilities.put("issueCard", new AccountHolderCapability().enabled(false).requested(false));
            capabilities.put("useCard", new AccountHolderCapability().enabled(false).requested(false));
        }

        accountHolderInfo.setCapabilities(capabilities);

        AccountHolder accountHolder = accountHoldersApi.createAccountHolder(accountHolderInfo);
        return accountHolder.getId();
    }

    public void updateAccountHolder(String accountHolderId, Long id, String firstName, String lastName, String legalName, String userType) throws IOException, ApiException {
        AccountHolderUpdateRequest accountHolderUpdateRequest = new AccountHolderUpdateRequest()
                .reference(getReference(firstName, lastName, legalName, userType).concat("_").concat(id.toString()));
        accountHoldersApi.updateAccountHolder(accountHolderId, accountHolderUpdateRequest);
    }

    private static String getReference(String firstName, String lastName, String legalName, String userType) {
        return userType.equals("individual")
                ? firstName + " " + lastName
                : legalName;
    }
}
