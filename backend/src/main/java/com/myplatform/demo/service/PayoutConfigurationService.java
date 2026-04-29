package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.*;
import com.adyen.model.legalentitymanagement.BankAccountInfoAccountIdentification;
import com.adyen.model.legalentitymanagement.TransferInstrument;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.TransferInstrumentsApi;
import com.myplatform.demo.model.PayoutConfigurationResponse;
import com.myplatform.demo.model.User;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Service
public class PayoutConfigurationService {

    private final BalanceAccountsApi balanceAccountsApi;
    private final TransferInstrumentsApi transferInstrumentsApi;

    public PayoutConfigurationService(@Qualifier("balancePlatformClient") Client balancePlatformClient,
                                      @Qualifier("lemClient") Client lemClient) {
        this.balanceAccountsApi = new BalanceAccountsApi(balancePlatformClient);
        this.transferInstrumentsApi = new TransferInstrumentsApi(lemClient);
    }

    public PayoutConfigurationResponse createPayoutConfiguration(String balanceAccountId, String currencyCode,
                                                                 Boolean regular, Boolean instant,
                                                                 String transferInstrumentId, String schedule) throws IOException, ApiException {

        String accountIdentifier = getAccountIdentifier(transferInstrumentId);

        CreateSweepConfigurationV2 createSweepConfigurationV2 = new CreateSweepConfigurationV2();
        createSweepConfigurationV2.type(CreateSweepConfigurationV2.TypeEnum.PUSH);
        createSweepConfigurationV2.triggerAmount(new Amount().currency(currencyCode).value(0L));
        createSweepConfigurationV2.currency(currencyCode);
        createSweepConfigurationV2.category(CreateSweepConfigurationV2.CategoryEnum.BANK);
        if (regular) {
            createSweepConfigurationV2.addPrioritiesItem(CreateSweepConfigurationV2.PrioritiesEnum.REGULAR);
        }
        if (instant) {
            createSweepConfigurationV2.addPrioritiesItem(CreateSweepConfigurationV2.PrioritiesEnum.INSTANT);
        }
        SweepCounterparty sweepCounterparty = new SweepCounterparty();
        sweepCounterparty.setTransferInstrumentId(transferInstrumentId);

        SweepSchedule sweepSchedule = new SweepSchedule().type(SweepSchedule.TypeEnum.fromValue(schedule));
        createSweepConfigurationV2.setSchedule(sweepSchedule);
        createSweepConfigurationV2.counterparty(sweepCounterparty);
        createSweepConfigurationV2.description("Payout for " + balanceAccountId);
        balanceAccountsApi.createSweep(balanceAccountId, createSweepConfigurationV2);

        PayoutConfigurationResponse payoutConfigurationResponse = new PayoutConfigurationResponse();
        payoutConfigurationResponse.setAccountIdentifier(accountIdentifier);
        payoutConfigurationResponse.setBalanceAccountId(balanceAccountId);
        payoutConfigurationResponse.setCurrencyCode(currencyCode);
        payoutConfigurationResponse.setInstant(instant);
        payoutConfigurationResponse.setRegular(regular);
        payoutConfigurationResponse.setSchedule(schedule);

        return payoutConfigurationResponse;
    }

    public List<PayoutConfigurationResponse> getPayoutConfigurations(User user, String balanceAccountId) throws IOException, ApiException {
        List<PayoutConfigurationResponse> payoutConfigs = new ArrayList<>();

        List<SweepConfigurationV2> sweeps = balanceAccountsApi
                .getAllSweepsForBalanceAccount(balanceAccountId)
                .getSweeps();

        if (sweeps != null) {
            for (SweepConfigurationV2 sweep : sweeps) {
                PayoutConfigurationResponse response = getPayoutConfigurationResponse(balanceAccountId, sweep);
                payoutConfigs.add(response);
            }
        }

        return payoutConfigs;
    }

    private PayoutConfigurationResponse getPayoutConfigurationResponse(String balanceAccountId, SweepConfigurationV2 sweep) throws IOException, ApiException {
        PayoutConfigurationResponse response = new PayoutConfigurationResponse();

        response.setBalanceAccountId(balanceAccountId);
        response.setCurrencyCode(sweep.getCurrency());
        response.setSchedule(
                sweep.getSchedule() != null ? sweep.getSchedule().getType().toString() : null
        );

        List<SweepConfigurationV2.PrioritiesEnum> prioritiesEnums = sweep.getPriorities();
        response.setInstant(false);
        response.setRegular(false);
        for (SweepConfigurationV2.PrioritiesEnum prioritiesEnum : prioritiesEnums) {
            if (prioritiesEnum.getValue().equals("instant")) {
                response.setInstant(true);
            }
            if (prioritiesEnum.getValue().equals("regular")) {
                response.setRegular(true);
            }
        }

        String accountIdentifier = getAccountIdentifier(sweep.getCounterparty().getTransferInstrumentId());
        response.setAccountIdentifier(accountIdentifier);
        return response;
    }

    private String getAccountIdentifier(String transferInstrumentId) throws ApiException, IOException {
        String accountIdentifier = "";

        TransferInstrument transferInstrument = transferInstrumentsApi.getTransferInstrument(transferInstrumentId);
        Object object = transferInstrument.getBankAccount().getAccountIdentification().getActualInstance();

        BankAccountInfoAccountIdentification bankAccountInfoAccountIdentification = transferInstrument.getBankAccount().getAccountIdentification();

        accountIdentifier = switch (object.getClass().getName()) {
            case "com.adyen.model.legalentitymanagement.IbanAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getIbanAccountIdentification().getIban();
            case "com.adyen.model.legalentitymanagement.USLocalAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getUSLocalAccountIdentification().getAccountNumber();
            case "com.adyen.model.legalentitymanagement.UKLocalAccountIdentification" ->
                    bankAccountInfoAccountIdentification.getUKLocalAccountIdentification().getAccountNumber();
            default -> accountIdentifier;
        };

        return accountIdentifier;
    }
}
