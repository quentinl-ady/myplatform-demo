package com.myplatform.demo.dto;

import java.time.Instant;
import java.util.List;

/**
 * The movements of a balance account that an automatic sweep moved: those that became available since the sweep
 * before.
 *
 * @param amount          what the sweep moved, unsigned, in minor units
 * @param previousSweepAt when the sweep before ran, null when none was found
 * @param itemsTotal      the sum of the movements, signed
 * @param carriedOver     what the sweep moved besides the movements: a balance left by the sweep before, or older
 *                        movements when the sweep before wasn't found
 * @param complete        false when movements may be missing from the list
 */
public record SweepBreakdownDTO(String transferId,
                                String balanceAccountId,
                                String currency,
                                long amount,
                                Instant sweptAt,
                                Instant previousSweepAt,
                                String previousTransferId,
                                List<Item> items,
                                long itemsTotal,
                                long carriedOver,
                                boolean complete,
                                List<String> warnings) {

    /**
     * @param kind   PAYMENT, FEE, REFUND, CHARGEBACK, TRANSFER or OTHER
     * @param amount signed: positive when it credited the balance account
     */
    public record Item(String transactionId,
                       String transferId,
                       String kind,
                       String label,
                       String reference,
                       String pspReference,
                       long amount,
                       String currency,
                       Instant bookedAt,
                       Instant availableAt) {
    }
}
