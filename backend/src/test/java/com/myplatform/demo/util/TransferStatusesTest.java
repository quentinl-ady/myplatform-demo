package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TransferStatusesTest {

    @Test
    void aTransferWaitsForItsApprovalUntilAdyenMovesItOn() {
        assertThat(TransferStatuses.awaitsApproval("received", "pending")).isTrue();
        assertThat(TransferStatuses.awaitsApproval("approvalPending", null)).isTrue();
    }

    @Test
    void aTransferWhoseApprovalExpiredNoLongerWaits() {
        assertThat(TransferStatuses.awaitsApproval("cancelled", "approvalExpired")).isFalse();
        assertThat(TransferStatuses.awaitsApproval("received", "approvalExpired")).isFalse();
    }

    @Test
    void anApprovedOrCancelledTransferNoLongerWaits() {
        assertThat(TransferStatuses.awaitsApproval("authorised", "approved")).isFalse();
        assertThat(TransferStatuses.awaitsApproval("booked", "approved")).isFalse();
        assertThat(TransferStatuses.awaitsApproval("cancelled", "cancelled")).isFalse();
    }
}
