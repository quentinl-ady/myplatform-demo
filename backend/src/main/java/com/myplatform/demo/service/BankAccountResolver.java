package com.myplatform.demo.service;

import com.adyen.service.exception.ApiException;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.User;
import org.springframework.stereotype.Service;

import java.io.IOException;

/**
 * Payment instruments of the business bank account of a user. The user stores one of them;
 * the balance account links the physical one (SCA devices are registered on it) and the
 * virtual one (transfers are sent from it, devices must be associated with it).
 */
@Service
public class BankAccountResolver {

    private final BalanceAccountService balanceAccountService;

    public BankAccountResolver(BalanceAccountService balanceAccountService) {
        this.balanceAccountService = balanceAccountService;
    }

    public boolean hasBankAccount(User user) {
        return user.getBankAccountId() != null && !user.getBankAccountId().isBlank();
    }

    public String physicalPi(User user) throws IOException, ApiException {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                String physicalPi = balanceAccountService.getPhysicalBankAccountId(baId);
                if (physicalPi != null) {
                    return physicalPi;
                }
            }
        }
        return user.getBankAccountId();
    }

    /** The virtual bank account, or null when the balance account has none. */
    public String virtualPi(User user) throws IOException, ApiException {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                return balanceAccountService.getVirtualBankAccountId(baId);
            }
        }
        return null;
    }

    /** The payment instrument transfers are sent from: the virtual bank account when there is one. */
    public String transferPi(User user) throws IOException, ApiException {
        if (user.getBankAccountId() != null) {
            String baId = balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
            if (baId != null) {
                String virtualPi = balanceAccountService.getVirtualBankAccountId(baId);
                if (virtualPi != null) {
                    return virtualPi;
                }
                String physicalPi = balanceAccountService.getPhysicalBankAccountId(baId);
                if (physicalPi != null) {
                    return physicalPi;
                }
            }
        }
        return user.getBankAccountId();
    }

    public String balanceAccountId(User user) throws IOException, ApiException {
        if (user.getBankAccountId() == null) {
            throw new BadRequestException("User has no bank account");
        }
        return balanceAccountService.getBalanceAccountIdForPaymentInstrument(user.getBankAccountId());
    }
}
