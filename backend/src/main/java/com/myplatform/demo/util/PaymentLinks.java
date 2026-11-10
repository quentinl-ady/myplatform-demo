package com.myplatform.demo.util;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The addresses customers open Adyen payment links at. */
public final class PaymentLinks {

    private static final Pattern TEST_SHORT_URL = Pattern.compile("https://test\\.adyen\\.link/([A-Za-z0-9]+)");
    private static final String TEST_PAGE_URL = "https://checkoutshopper-test.adyen.com/checkoutshopper/payByLink.shtml?d=";

    private PaymentLinks() {
    }

    /**
     * The address of the page of a payment link. Adyen gives TEST links a short address on test.adyen.link, which some
     * networks can't reach: they get the address of the same page on checkoutshopper-test.adyen.com instead. Other
     * addresses are kept.
     */
    public static String pageUrl(String url) {
        if (url == null) {
            return null;
        }
        Matcher shortUrl = TEST_SHORT_URL.matcher(url);
        return shortUrl.matches() ? TEST_PAGE_URL + shortUrl.group(1) : url;
    }
}
