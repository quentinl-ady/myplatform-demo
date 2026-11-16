package com.myplatform.demo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.dto.BillPaymentRequest;
import com.myplatform.demo.dto.BillTransferRoutesDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.model.Bill;
import com.myplatform.demo.model.Supplier;
import com.myplatform.demo.model.TransferRouteOption;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.BillRepository;
import com.myplatform.demo.repository.CardRepository;
import com.myplatform.demo.repository.SupplierRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BillServiceTest {

    private static final String USER_ID = "U1";
    private static final String FR_IBAN = "FR6410096000403534259742Y90";
    private static final String DE_IBAN = "DE14100100109876543210";
    private static final String NO_FAST_ROUTE = "Fast transfers are not available for this beneficiary";

    private final BillRepository billRepository = mock(BillRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final TransferRouteService transferRouteService = mock(TransferRouteService.class);
    private final BankAccountResolver bankAccounts = mock(BankAccountResolver.class);
    private final BillService service = new BillService(billRepository, mock(SupplierRepository.class), userRepository,
            mock(CardRepository.class), mock(WebhookEventRepository.class), mock(TransferService.class),
            transferRouteService, bankAccounts, mock(BankValidationService.class), mock(IssuingService.class),
            mock(CardRangeCatalog.class), mock(CardTransferService.class), new ObjectMapper(), mock(EntityManager.class));

    @BeforeEach
    void businessAccount() throws Exception {
        User user = new User();
        user.setId(USER_ID);
        user.setCurrencyCode("EUR");
        user.setAccountHolderId("AH1");
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(bankAccounts.hasBankAccount(user)).thenReturn(true);
        when(bankAccounts.balanceAccountId(user)).thenReturn("BA1");
    }

    @Test
    void aBillOffersTheSpeedsOfTheRoutesToItsSupplierWithinTheirLimits() throws Exception {
        Supplier supplier = supplier(1L, "CloudNest Software", FR_IBAN);
        bill(10L, supplier, 12_000);
        bill(11L, supplier, 15_000_000);
        when(transferRouteService.calculateRoutes(eq("BA1"), any(), argThat(to -> to != null && FR_IBAN.equals(to.getIban()))))
                .thenReturn(List.of(new TransferRouteOption("regular", 1L, null, false, List.of()),
                        new TransferRouteOption("instant", 1L, 10_000_000L, false, List.of())));

        List<BillTransferRoutesDTO> routes = service.transferRoutes(USER_ID, new BillPaymentRequest(List.of(10L, 11L), null));

        assertThat(routes).extracting(BillTransferRoutesDTO::billId).containsExactly(10L, 11L);
        assertThat(routes.get(0).speeds()).containsExactly(
                new BillTransferRoutesDTO.Speed("regular", true, null),
                new BillTransferRoutesDTO.Speed("fast", false, NO_FAST_ROUTE),
                new BillTransferRoutesDTO.Speed("instant", true, null));
        assertThat(routes.get(1).speeds()).containsExactly(
                new BillTransferRoutesDTO.Speed("regular", true, null),
                new BillTransferRoutesDTO.Speed("fast", false, NO_FAST_ROUTE),
                new BillTransferRoutesDTO.Speed("instant", false,
                        "The maximum amount for instant transfers to this beneficiary is 100000.00 EUR"));
        // Both bills go to the same bank account.
        verify(transferRouteService, times(1)).calculateRoutes(any(), any(), any());
    }

    @Test
    void aSupplierWhoseRoutesCantBeCheckedOnlyLeavesItsOwnBillsOut() throws Exception {
        bill(10L, supplier(1L, "CloudNest Software", FR_IBAN), 12_000);
        bill(20L, supplier(2L, "Metro Office Supplies", null), 5_000);
        bill(30L, supplier(3L, "Harbor Workspace", DE_IBAN), 7_000);
        when(transferRouteService.calculateRoutes(eq("BA1"), any(), argThat(to -> to != null && FR_IBAN.equals(to.getIban()))))
                .thenReturn(List.of(new TransferRouteOption("regular", null, null, false, List.of())));
        when(transferRouteService.calculateRoutes(eq("BA1"), any(), argThat(to -> to != null && DE_IBAN.equals(to.getIban()))))
                .thenThrow(new BadRequestException("The transfer speeds couldn't be checked: Invalid IBAN"));

        List<BillTransferRoutesDTO> routes = service.transferRoutes(USER_ID,
                new BillPaymentRequest(List.of(10L, 20L, 30L), null));

        assertThat(routes.get(0).error()).isNull();
        assertThat(routes.get(0).speeds()).filteredOn(BillTransferRoutesDTO.Speed::available)
                .extracting(BillTransferRoutesDTO.Speed::priority).containsExactly("regular");
        assertThat(routes.get(1).speeds()).isEmpty();
        assertThat(routes.get(1).error()).isEqualTo("Add the bank details of Metro Office Supplies to pay this bill by transfer.");
        assertThat(routes.get(2).speeds()).isEmpty();
        assertThat(routes.get(2).error()).isEqualTo("The transfer speeds couldn't be checked: Invalid IBAN");
    }

    private static Supplier supplier(Long id, String name, String iban) {
        Supplier supplier = new Supplier();
        supplier.setId(id);
        supplier.setUserId(USER_ID);
        supplier.setName(name);
        if (iban != null) {
            supplier.setBankAccountFormat("iban");
            supplier.setIban(iban);
        }
        return supplier;
    }

    private void bill(Long id, Supplier supplier, long total) {
        Bill bill = new Bill();
        bill.setId(id);
        bill.setUserId(USER_ID);
        bill.setSupplier(supplier);
        bill.setCurrency("EUR");
        bill.setTotal(total);
        bill.setStatus(Bill.Status.TO_PAY);
        when(billRepository.findByIdAndUserId(id, USER_ID)).thenReturn(Optional.of(bill));
    }
}
