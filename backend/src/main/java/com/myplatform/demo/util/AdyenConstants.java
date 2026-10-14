package com.myplatform.demo.util;

import java.util.Set;

public final class AdyenConstants {

    private AdyenConstants() {}

    // The 2025 entrants (AL, MD, ME, MK, RS) are left out: only some of their banks are reachable through SEPA.
    public static final Set<String> SEPA_COUNTRIES = Set.of(
            "AD", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
            "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "MC", "NL",
            "NO", "PL", "PT", "RO", "SM", "SK", "SI", "ES", "SE", "CH", "GB", "VA"
    );
}
