package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.enums.Environment;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.myplatform.demo.configuration.ApiLogContext;
import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.TerminalResultDTO;
import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Customer;
import com.myplatform.demo.model.Invoice;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.CustomerRepository;
import com.myplatform.demo.repository.InvoiceRepository;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.repository.WebhookEventRepository;
import com.myplatform.demo.util.InvoiceTerminalRules.OriginalTransaction;
import com.myplatform.demo.util.TerminalOutcome;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class InvoiceTerminalServiceTest {

    private static final String USER_ID = "U1";
    private static final String TERMINAL = "S1F2-000158234567890";
    private static final String OTHER_TERMINAL = "V400m-324688179";
    private static final String TERMINAL_OF_ANOTHER_USER = "P400Plus-275039202";
    private static final String UNKNOWN_TERMINAL = "S1F2-000158200000000";
    private static final Long INVOICE_ID = 7L;
    private static final String NUMBER = "INV-2026-0007";
    private static final Instant PAID_AT = Instant.parse("2026-11-16T09:58:00Z");
    private static final String BUSY = "Terminal " + TERMINAL + " is collecting the payment of " + NUMBER
            + ". Try again once it's done.";

    private final InvoiceRepository invoiceRepository = mock(InvoiceRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final TerminalDirectory terminalDirectory = mock(TerminalDirectory.class);
    private final PosService posService = mock(PosService.class);
    private final SubscriptionService subscriptionService = mock(SubscriptionService.class);
    private final InvoiceService invoiceService = new InvoiceService(new Client("test", Environment.TEST), "Merchant",
            invoiceRepository, mock(CustomerRepository.class), userRepository, mock(StoreCustomerRepository.class),
            mock(WebhookEventRepository.class), mock(CheckoutPaymentService.class), mock(LegalEntityService.class),
            mock(AccountStatementService.class), mock(InvoicePdfService.class), new ObjectMapper(),
            mock(EntityManager.class), mock(InvoiceFundsService.class));
    private final InvoiceTerminalService service = new InvoiceTerminalService(invoiceService, terminalDirectory,
            posService, subscriptionService, userRepository);
    private final ExecutorService otherRequests = Executors.newSingleThreadExecutor();

    @BeforeEach
    void storesAndTerminals() {
        User user = new User();
        user.setId(USER_ID);
        when(userRepository.findById(USER_ID)).thenReturn(Optional.of(user));
        when(terminalDirectory.owner(TERMINAL)).thenReturn(Optional.of(owner(TERMINAL, USER_ID)));
        when(terminalDirectory.owner(OTHER_TERMINAL)).thenReturn(Optional.of(owner(OTHER_TERMINAL, USER_ID)));
        when(terminalDirectory.owner(TERMINAL_OF_ANOTHER_USER))
                .thenReturn(Optional.of(owner(TERMINAL_OF_ANOTHER_USER, "U2")));
        when(invoiceRepository.save(any(Invoice.class))).thenAnswer(call -> call.getArgument(0));
    }

    @AfterEach
    void cleanUp() {
        otherRequests.shutdownNow();
        ApiLogContext.clear();
    }

    @Test
    void onlyTheTerminalsOfTheStoresOfTheUserCollectItsInvoices() {
        Invoice invoice = store(sent());

        assertThatThrownBy(() -> service.pay(USER_ID, INVOICE_ID, TERMINAL_OF_ANOTHER_USER))
                .isInstanceOf(ResourceNotFoundException.class).hasMessage("This terminal isn't in one of your stores.");
        assertThatThrownBy(() -> service.refund(USER_ID, INVOICE_ID, UNKNOWN_TERMINAL))
                .isInstanceOf(ResourceNotFoundException.class).hasMessage("This terminal isn't in one of your stores.");
        assertThatThrownBy(() -> service.pay(USER_ID, INVOICE_ID, " "))
                .isInstanceOf(BadRequestException.class).hasMessage("Choose a terminal.");
        // The app of a terminal only sees the invoices of the user of its store.
        assertThatThrownBy(() -> service.collectAt(TERMINAL_OF_ANOTHER_USER, INVOICE_ID))
                .isInstanceOf(ResourceNotFoundException.class).hasMessage("Invoice not found");
        assertThatThrownBy(() -> service.collectAt(UNKNOWN_TERMINAL, INVOICE_ID))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("This terminal isn't assigned to a store of the platform.");

        verifyNoInteractions(posService);
        assertThat(invoice.getEvents()).isEmpty();
    }

    @Test
    void aPaymentApprovedAtTheTerminalPaysTheInvoice() {
        Invoice invoice = sent();
        invoice.setSubscriptionId(3L);
        store(invoice);
        when(posService.pay(eq(TERMINAL), anyString(), eq(NUMBER), eq(1200L), eq("EUR"))).thenReturn(approved("PSP1"));

        TerminalResultDTO result = service.pay(USER_ID, INVOICE_ID, TERMINAL);

        assertThat(result.outcome()).isEqualTo("APPROVED");
        assertThat(result.message()).isNull();
        assertThat(result.pspReference()).isEqualTo("PSP1");
        InvoiceDTO paid = result.invoice();
        assertThat(paid.status()).isEqualTo("PAID");
        assertThat(paid.terminalId()).isEqualTo(TERMINAL);
        assertThat(paid.terminalPayable()).isFalse();
        assertThat(paid.refundable()).isTrue();
        assertThat(paid.events()).extracting(InvoiceDTO.Event::type, InvoiceDTO.Event::detail)
                .containsExactly(tuple("PAID", "Paid at terminal " + TERMINAL + " with Visa •••• 1111."));
        verify(subscriptionService).sync(3L);
    }

    @Test
    void anInvoiceThatCantBePaidOrRefundedThereNeverReachesTheTerminal() {
        store(paid());
        assertThatThrownBy(() -> service.pay(USER_ID, INVOICE_ID, TERMINAL))
                .isInstanceOf(ConflictException.class).hasMessage("This invoice is already paid.");

        store(sent());
        assertThatThrownBy(() -> service.refundAt(TERMINAL, INVOICE_ID))
                .isInstanceOf(ConflictException.class).hasMessage("Only a paid invoice can be refunded.");

        verifyNoInteractions(posService);
    }

    @Test
    void whileATerminalWaitsForTheCardTheInvoiceCantBePaidRefundedSentOrVoidedOtherwise() throws Exception {
        Invoice invoice = store(sent());
        List<Throwable> refused = new ArrayList<>();
        when(posService.pay(eq(TERMINAL), anyString(), any(), anyLong(), any())).thenAnswer(call -> {
            // These requests would time out if the invoice stayed locked while the terminal waits.
            refused.add(elsewhere(() -> service.pay(USER_ID, INVOICE_ID, OTHER_TERMINAL)));
            refused.add(elsewhere(() -> service.collectAt(OTHER_TERMINAL, INVOICE_ID)));
            refused.add(elsewhere(() -> service.refund(USER_ID, INVOICE_ID, OTHER_TERMINAL)));
            refused.add(elsewhere(() -> invoiceService.send(USER_ID, INVOICE_ID)));
            refused.add(elsewhere(() -> invoiceService.voidInvoice(USER_ID, INVOICE_ID)));
            return TerminalOutcome.of(TerminalOutcome.Result.CANCELLED, "The payment was cancelled.");
        });
        when(posService.pay(eq(OTHER_TERMINAL), anyString(), any(), anyLong(), any())).thenReturn(approved("PSP1"));

        assertThat(service.pay(USER_ID, INVOICE_ID, TERMINAL).outcome()).isEqualTo("CANCELLED");

        assertThat(refused).hasSize(5).allSatisfy(failure ->
                assertThat(failure).isInstanceOf(ConflictException.class).hasMessage(BUSY));
        // Once the terminal answered, the invoice is free again.
        assertThat(service.pay(USER_ID, INVOICE_ID, OTHER_TERMINAL).invoice().status()).isEqualTo("PAID");
        assertThat(invoice.getTerminalId()).isEqualTo(OTHER_TERMINAL);
    }

    @Test
    void cancellingAbortsThePaymentTheTerminalWaitsFor() throws Exception {
        Invoice invoice = store(sent());
        assertThatThrownBy(() -> service.cancel(USER_ID, INVOICE_ID))
                .isInstanceOf(ConflictException.class).hasMessage("No terminal is collecting the payment of this invoice.");
        List<Throwable> cancellations = new ArrayList<>();
        when(posService.pay(eq(TERMINAL), anyString(), any(), anyLong(), any())).thenAnswer(call -> {
            cancellations.add(elsewhere(() -> {
                service.cancel(USER_ID, INVOICE_ID);
                return null;
            }));
            return TerminalOutcome.of(TerminalOutcome.Result.CANCELLED, "The payment was cancelled.");
        });

        TerminalResultDTO result = service.pay(USER_ID, INVOICE_ID, TERMINAL);

        ArgumentCaptor<String> serviceId = ArgumentCaptor.forClass(String.class);
        verify(posService).pay(eq(TERMINAL), serviceId.capture(), eq(NUMBER), eq(1200L), eq("EUR"));
        verify(posService).abortPayment(TERMINAL, serviceId.getValue());
        assertThat(cancellations).hasSize(1).containsOnlyNulls();
        assertThat(result.outcome()).isEqualTo("CANCELLED");
        assertThat(result.message()).isEqualTo("The payment was cancelled.");
        assertThat(result.invoice().status()).isEqualTo("SENT");
        assertThat(result.invoice().terminalPayable()).isTrue();
        assertThat(invoice.getEvents()).isEmpty();
    }

    @Test
    void aCancellationTheTerminalDidntTakeIsReported() throws Exception {
        store(sent());
        when(posService.abortPayment(eq(TERMINAL), anyString()))
                .thenReturn("The terminal is busy with another request.")
                .thenThrow(new IOException("Read timed out"));
        List<Throwable> failures = new ArrayList<>();
        when(posService.pay(eq(TERMINAL), anyString(), any(), anyLong(), any())).thenAnswer(call -> {
            for (int attempt = 0; attempt < 2; attempt++) {
                failures.add(elsewhere(() -> {
                    service.cancel(USER_ID, INVOICE_ID);
                    return null;
                }));
            }
            return approved("PSP1");
        });

        assertThat(service.pay(USER_ID, INVOICE_ID, TERMINAL).outcome()).isEqualTo("APPROVED");

        assertThat(failures).hasSize(2).hasOnlyElementsOfType(ResponseStatusException.class);
        assertThat(failures).extracting(failure -> ((ResponseStatusException) failure).getStatusCode())
                .containsOnly(HttpStatus.BAD_GATEWAY);
        assertThat(failures).extracting(failure -> ((ResponseStatusException) failure).getReason()).containsExactly(
                "The terminal is busy with another request.",
                "Couldn't reach the terminal. Cancel the payment on its screen.");
    }

    @Test
    void aFailureWhileWaitingForTheTerminalLeavesThePaymentUnknownAndTheInvoiceFree() {
        Invoice invoice = store(sent());
        when(posService.pay(eq(TERMINAL), anyString(), any(), anyLong(), any()))
                .thenThrow(new IllegalStateException("Connection reset"))
                .thenReturn(approved("PSP1"));

        TerminalResultDTO result = service.pay(USER_ID, INVOICE_ID, TERMINAL);

        assertThat(result.outcome()).isEqualTo("UNKNOWN");
        assertThat(result.message()).isEqualTo(
                "Something went wrong while waiting for the terminal. Check its screen before trying again.");
        assertThat(result.invoice().status()).isEqualTo("SENT");
        assertThat(result.invoice().terminalPayable()).isTrue();
        assertThat(invoice.getEvents()).isEmpty();
        assertThat(service.pay(USER_ID, INVOICE_ID, TERMINAL).outcome()).isEqualTo("APPROVED");
    }

    @Test
    void theAppRefundsWhatThePaymentHasntGivenBackYet() {
        Invoice invoice = paid();
        // 2.00 EUR refunded otherwise already.
        invoice.setRefundStatus(Invoice.RefundStatus.REFUNDED);
        invoice.setRefundPspReference("CA1");
        invoice.setRefundedAmount(200L);
        store(invoice);
        when(posService.reverse(eq(TERMINAL), anyString(), eq(NUMBER), any(), eq(1000L), eq("EUR"))).thenReturn(
                new TerminalOutcome(TerminalOutcome.Result.APPROVED, null, null, "REF1", null, null, null, null));

        TerminalResultDTO result = service.refundAt(TERMINAL, INVOICE_ID);

        verify(posService).reverse(eq(TERMINAL), anyString(), eq(NUMBER),
                eq(new OriginalTransaction(".PSP1", PAID_AT, false)), eq(1000L), eq("EUR"));
        assertThat(ApiLogContext.getUserId()).isEqualTo(USER_ID);
        assertThat(result.outcome()).isEqualTo("REQUESTED");
        assertThat(result.pspReference()).isEqualTo("REF1");
        assertThat(result.invoice().refund().status()).isEqualTo("REQUESTED");
        assertThat(result.invoice().refund().terminalId()).isEqualTo(TERMINAL);
        assertThat(result.invoice().refund().pspReference()).isEqualTo("REF1");
        assertThat(result.invoice().refundedAmount()).isEqualTo(200L);
        assertThat(result.invoice().refundable()).isFalse();
        assertThatThrownBy(() -> service.refund(USER_ID, INVOICE_ID, OTHER_TERMINAL))
                .isInstanceOf(ConflictException.class).hasMessage("A refund of this invoice is already in progress.");
    }

    @Test
    void aRefundTheTerminalRefusedCanBeTriedAgain() {
        store(paid());
        when(posService.reverse(eq(TERMINAL), anyString(), any(), any(), anyLong(), any())).thenReturn(
                new TerminalOutcome(TerminalOutcome.Result.CANCELLED, "The refund was cancelled at the terminal.",
                        null, null, null, null, null, null));

        TerminalResultDTO result = service.refund(USER_ID, INVOICE_ID, TERMINAL);

        assertThat(result.outcome()).isEqualTo("DECLINED");
        assertThat(result.message()).isEqualTo("The refund was cancelled at the terminal.");
        assertThat(result.invoice().refund().status()).isEqualTo("FAILED");
        assertThat(result.invoice().refund().failureReason()).isEqualTo("The refund was cancelled at the terminal.");
        assertThat(result.invoice().refundable()).isTrue();
    }

    @Test
    void aPaymentApprovedOnceTheInvoiceWasPaidOtherwiseAsksForARefund() {
        Invoice invoice = store(sent());
        when(posService.pay(eq(TERMINAL), anyString(), any(), anyLong(), any())).thenAnswer(call -> {
            // Meanwhile, the customer paid with the payment link, and its webhook arrived.
            invoice.setStatus(Invoice.Status.PAID);
            invoice.setPspReference("PSP-LINK");
            invoice.setPaidAt(PAID_AT);
            return approved("PSP1");
        });

        TerminalResultDTO result = service.pay(USER_ID, INVOICE_ID, TERMINAL);

        assertThat(result.outcome()).isEqualTo("APPROVED");
        assertThat(result.message()).isEqualTo(
                "The invoice was paid otherwise in the meantime, so the customer paid twice. Refund this payment.");
        assertThat(result.invoice().pspReference()).isEqualTo("PSP-LINK");
        assertThat(result.invoice().terminalId()).isNull();
    }

    /**
     * Runs a request on another thread, as a second HTTP request would. Returns how it failed, null when it didn't.
     */
    private Throwable elsewhere(Callable<?> request) throws Exception {
        try {
            otherRequests.submit(request).get(5, TimeUnit.SECONDS);
            return null;
        } catch (ExecutionException e) {
            return e.getCause();
        }
    }

    private Invoice store(Invoice invoice) {
        when(invoiceRepository.findByIdAndUserId(INVOICE_ID, USER_ID)).thenReturn(Optional.of(invoice));
        when(invoiceRepository.findById(INVOICE_ID)).thenReturn(Optional.of(invoice));
        return invoice;
    }

    /** Sent, with an expired payment link: nothing asks Adyen about it. */
    private static Invoice sent() {
        Customer customer = new Customer();
        customer.setId(1L);
        customer.setName("Jane Doe");
        customer.setEmail("jane@example.com");
        Invoice invoice = new Invoice();
        invoice.setId(INVOICE_ID);
        invoice.setUserId(USER_ID);
        invoice.setNumber(NUMBER);
        invoice.setCustomer(customer);
        invoice.setStatus(Invoice.Status.SENT);
        invoice.setIssueDate(LocalDate.now(ZoneOffset.UTC));
        invoice.setDueDate(LocalDate.now(ZoneOffset.UTC).plusDays(30));
        invoice.setCurrency("EUR");
        invoice.setSubtotal(1000L);
        invoice.setTaxTotal(200L);
        invoice.setTotal(1200L);
        invoice.setPaymentLinkId("PL1");
        invoice.setPaymentLinkStatus("expired");
        return invoice;
    }

    private static Invoice paid() {
        Invoice invoice = sent();
        invoice.setStatus(Invoice.Status.PAID);
        invoice.setPspReference("PSP1");
        invoice.setPaidAt(PAID_AT);
        return invoice;
    }

    private static TerminalDirectory.Owner owner(String terminalId, String userId) {
        return new TerminalDirectory.Owner(terminalId, "S1F2", "ST1", "Main store", "Paris", userId);
    }

    private static TerminalOutcome approved(String pspReference) {
        return new TerminalOutcome(TerminalOutcome.Result.APPROVED, null, null, pspReference, "tx." + pspReference,
                PAID_AT, "visa", "411111******1111");
    }
}
