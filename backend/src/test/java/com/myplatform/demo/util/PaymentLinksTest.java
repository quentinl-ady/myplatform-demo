package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class PaymentLinksTest {

    @Test
    void aTestLinkOpensAtItsPageOnCheckoutshopperTest() {
        assertThat(PaymentLinks.pageUrl("https://test.adyen.link/PL0123456789ABCDEF0123456"))
                .isEqualTo("https://checkoutshopper-test.adyen.com/checkoutshopper/payByLink.shtml?d=PL0123456789ABCDEF0123456");
    }

    @Test
    void otherAddressesAreKept() {
        assertThat(PaymentLinks.pageUrl("https://eu.adyen.link/PL0123456789ABCDEF0123456"))
                .isEqualTo("https://eu.adyen.link/PL0123456789ABCDEF0123456");
        assertThat(PaymentLinks.pageUrl("https://test.adyen.link/PL0123456789ABCDEF0123456?locale=fr-FR"))
                .isEqualTo("https://test.adyen.link/PL0123456789ABCDEF0123456?locale=fr-FR");
        assertThat(PaymentLinks.pageUrl(null)).isNull();
    }
}
