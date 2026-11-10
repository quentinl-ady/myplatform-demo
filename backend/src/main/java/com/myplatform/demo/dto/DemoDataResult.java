package com.myplatform.demo.dto;

import java.util.List;

/**
 * What loading the demo data created. Records that already exist aren't created again.
 *
 * @param warnings what couldn't be created, e.g. payment links when the account can't take payments yet
 */
public record DemoDataResult(int customersCreated,
                             int invoicesCreated,
                             int paymentLinksCreated,
                             int subscriptionsCreated,
                             int suppliersCreated,
                             int billsCreated,
                             List<String> warnings) {
}
