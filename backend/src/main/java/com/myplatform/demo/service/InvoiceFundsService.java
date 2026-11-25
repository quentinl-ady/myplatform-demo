package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.balanceplatform.SweepConfigurationV2;
import com.adyen.service.balanceplatform.BalanceAccountsApi;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.User;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class InvoiceFundsService {
    private static final Logger log = LoggerFactory.getLogger(InvoiceFundsService.class);
    private final BalanceAccountsApi balanceAccountsApi;
    private final BankAccountResolver bankAccountResolver;
    private final Map<String, Destination> destinations = new ConcurrentHashMap<>();

    private record Destination(String balanceAccountId, String type, String schedule, Instant expiresAt) {
    }

    public InvoiceFundsService(@Qualifier("balancePlatformClient") Client client, BankAccountResolver bankAccountResolver) {
        this.balanceAccountsApi = new BalanceAccountsApi(client);
        this.bankAccountResolver = bankAccountResolver;
    }

    public InvoiceDTO.Funds funds(Invoice invoice, User user) {
        if (invoice.getStatus() != Invoice.Status.PAID) return null;
        Destination destination = bankAccountResolver.hasBankAccount(user)
                ? new Destination(user.getBalanceAccountId(), "BUSINESS_ACCOUNT", null, Instant.MAX)
                : destinations.compute(user.getId(), (id, cached) ->
                cached != null && Objects.equals(cached.balanceAccountId(), user.getBalanceAccountId())
                        && cached.expiresAt().isAfter(Instant.now()) ? cached : lookup(user));
        return new InvoiceDTO.Funds(invoice.getFundsValueDate(), invoice.getFundsAmount(), invoice.getCurrency(),
                destination.type(), destination.schedule());
    }

    private Destination lookup(User user) {
        Instant expires = Instant.now().plus(Duration.ofMinutes(3));
        String account = user.getBalanceAccountId();
        if (account == null || account.isBlank()) return new Destination(account, null, null, expires);
        try {
            var sweeps = balanceAccountsApi.getAllSweepsForBalanceAccount(account).getSweeps();
            if (sweeps != null) {
                for (var sweep : sweeps) {
                    if (sweep.getStatus() == SweepConfigurationV2.StatusEnum.ACTIVE
                            && sweep.getType() == SweepConfigurationV2.TypeEnum.PUSH
                            && sweep.getCategory() == SweepConfigurationV2.CategoryEnum.BANK) {
                        String schedule = sweep.getSchedule() != null && sweep.getSchedule().getType() != null
                                ? sweep.getSchedule().getType().getValue() : null;
                        return new Destination(account, "PAYOUT", schedule, expires);
                    }
                }
            }
            return new Destination(account, "BALANCE", null, expires);
        } catch (Exception e) {
            log.warn("Couldn't determine the invoice funds destination of user {}", user.getId());
            return new Destination(account, null, null, expires);
        }
    }
}
