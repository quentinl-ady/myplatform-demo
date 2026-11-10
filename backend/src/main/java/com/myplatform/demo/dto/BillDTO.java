package com.myplatform.demo.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * A supplier bill as the Bills page shows it. Amounts are in minor units.
 *
 * @param status            TO_PAY, OVERDUE (to pay and past its due date), PENDING_APPROVAL (its transfer waits for an
 *                          approval), PROCESSING (approved transfer, or card issued), PAID or FAILED (to pay again)
 * @param daysOverdue       null unless the bill is overdue
 * @param paymentMethod     TRANSFER or CARD, null until a payment starts
 * @param transferStatus    as Adyen last reported it, e.g. received, authorised or booked
 * @param card              the single-use card that pays the bill, null when it isn't paid by card
 * @param payeeCheck        the last Verification of Payee of the supplier, null when it wasn't checked
 * @param failureReason     why the last payment failed
 * @param payableByTransfer the bill can be paid by transfer now
 * @param payableByCard     the bill can be paid with a single-use card now
 * @param cardCancellable   its card wasn't used yet, so it can be closed and the bill paid another way
 */
public record BillDTO(Long id,
                      String number,
                      String supplierReference,
                      String status,
                      Long daysOverdue,
                      SupplierRef supplier,
                      LocalDate issueDate,
                      LocalDate dueDate,
                      String currency,
                      long subtotal,
                      long taxTotal,
                      long total,
                      BigDecimal vatRate,
                      String category,
                      String categoryName,
                      String description,
                      String paymentMethod,
                      String transferId,
                      String transferStatus,
                      Card card,
                      PayeeCheck payeeCheck,
                      String failureReason,
                      Instant createdAt,
                      Instant paidAt,
                      List<Event> events,
                      boolean editable,
                      boolean deletable,
                      boolean payableByTransfer,
                      boolean payableByCard,
                      boolean cardCancellable) {

    /** @param bankAccount the account with only its last digits, null without bank details */
    public record SupplierRef(Long id, String name, String email, String country, String bankAccount,
                              String bankCountry) {
    }

    /** @param status active until the payment is booked, then closed */
    public record Card(String paymentInstrumentId, String brand, String lastFour, String status) {
    }

    /** @param name the name the supplier's bank has, for a partial match */
    public record PayeeCheck(String result, String name, Instant checkedAt) {
    }

    public record Event(String type, Instant occurredAt, String detail, String transferId) {
    }
}
