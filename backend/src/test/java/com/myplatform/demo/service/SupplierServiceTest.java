package com.myplatform.demo.service;

import com.myplatform.demo.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SupplierServiceTest {

    @Test
    void aSupplierWithoutVerificationOfPayeeResultGetsAMatch() {
        assertThat(SupplierService.vopScenario(null)).isNull();
        assertThat(SupplierService.vopScenario("  ")).isNull();
        assertThat(SupplierService.vopScenario("nameMatch")).isNull();
    }

    @Test
    void aSupplierCanSimulateTheOtherVerificationOfPayeeResults() {
        assertThat(SupplierService.vopScenario(" partialNameMatch ")).isEqualTo("partialNameMatch");
        assertThat(SupplierService.vopScenario("noNameMatch")).isEqualTo("noNameMatch");
        assertThat(SupplierService.vopScenario("nameMatchNotSupported")).isEqualTo("nameMatchNotSupported");
        assertThatThrownBy(() -> SupplierService.vopScenario("closeMatch")).isInstanceOf(BadRequestException.class);
    }
}
