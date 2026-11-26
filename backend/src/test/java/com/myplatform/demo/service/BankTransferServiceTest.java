package com.myplatform.demo.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BankTransferServiceTest {

    @Test
    void theSweepsFromTheSalesAccountAreSettlements() {
        assertThat(BankTransferService.displayDescription("Internal Transfer 2min")).isEqualTo("Settlement");
        assertThat(BankTransferService.displayDescription("Settlement")).isEqualTo("Settlement");
        assertThat(BankTransferService.displayDescription("Rent")).isEqualTo("Rent");
        assertThat(BankTransferService.displayDescription(null)).isNull();
    }
}
