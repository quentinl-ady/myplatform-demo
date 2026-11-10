package com.myplatform.demo.controller;

import com.myplatform.demo.dto.BillCardRequest;
import com.myplatform.demo.dto.BillDTO;
import com.myplatform.demo.dto.BillPaymentRequest;
import com.myplatform.demo.dto.BillPaymentResultDTO;
import com.myplatform.demo.dto.BillRequest;
import com.myplatform.demo.dto.BillSettingsDTO;
import com.myplatform.demo.dto.BillTransferRoutesDTO;
import com.myplatform.demo.dto.PayeeCheckDTO;
import com.myplatform.demo.service.BillService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Supplier bills, paid by transfer from the business account or with a single-use virtual card. */
@RestController
@RequestMapping("/api/bills")
public class BillController {

    private final BillService billService;

    public BillController(BillService billService) {
        this.billService = billService;
    }

    /** The currency, tax rates, categories, next number and payment options the bill pages need. */
    @GetMapping("/{userId}/settings")
    public ResponseEntity<BillSettingsDTO> settings(@PathVariable String userId) {
        return ResponseEntity.ok(billService.settings(userId));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<BillDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(billService.list(userId));
    }

    @GetMapping("/{userId}/{billId}")
    public ResponseEntity<BillDTO> get(@PathVariable String userId, @PathVariable Long billId) {
        return ResponseEntity.ok(billService.get(userId, billId));
    }

    @PostMapping("/{userId}")
    public ResponseEntity<BillDTO> create(@PathVariable String userId, @RequestBody BillRequest request) {
        return ResponseEntity.ok(billService.create(userId, request));
    }

    /** Only a bill to pay, or whose payment failed, can be edited. */
    @PutMapping("/{userId}/{billId}")
    public ResponseEntity<BillDTO> update(@PathVariable String userId, @PathVariable Long billId,
                                          @RequestBody BillRequest request) {
        return ResponseEntity.ok(billService.update(userId, billId, request));
    }

    @DeleteMapping("/{userId}/{billId}")
    public ResponseEntity<Void> delete(@PathVariable String userId, @PathVariable Long billId) {
        billService.delete(userId, billId);
        return ResponseEntity.noContent().build();
    }

    /** Verification of Payee of the suppliers of the selected bills, before they are paid by transfer. */
    @PostMapping("/{userId}/payee-checks")
    public ResponseEntity<List<PayeeCheckDTO>> checkPayees(@PathVariable String userId,
                                                           @RequestBody BillPaymentRequest request) {
        return ResponseEntity.ok(billService.checkPayees(userId, request));
    }

    /** The transfer speeds that can pay the selected bills, from the routes Adyen offers to the bank of each supplier. */
    @PostMapping("/{userId}/transfer-routes")
    public ResponseEntity<List<BillTransferRoutesDTO>> transferRoutes(@PathVariable String userId,
                                                                      @RequestBody BillPaymentRequest request) throws Exception {
        return ResponseEntity.ok(billService.transferRoutes(userId, request));
    }

    /** One transfer per bill, waiting for one approval with SCA on the Batch transfers page. */
    @PostMapping("/{userId}/pay-transfer")
    public ResponseEntity<BillPaymentResultDTO> payByTransfer(@PathVariable String userId,
                                                              @RequestBody BillPaymentRequest request) throws Exception {
        return ResponseEntity.ok(billService.payByTransfer(userId, request));
    }

    @PostMapping("/{userId}/{billId}/cancel-transfer")
    public ResponseEntity<BillDTO> cancelTransfer(@PathVariable String userId, @PathVariable Long billId) {
        return ResponseEntity.ok(billService.cancelTransfer(userId, billId));
    }

    @PostMapping("/{userId}/{billId}/pay-card")
    public ResponseEntity<BillDTO> payByCard(@PathVariable String userId, @PathVariable Long billId,
                                             @RequestBody(required = false) BillCardRequest request) throws Exception {
        return ResponseEntity.ok(billService.payByCard(userId, billId, request));
    }

    @PostMapping("/{userId}/{billId}/cancel-card")
    public ResponseEntity<BillDTO> cancelCard(@PathVariable String userId, @PathVariable Long billId) throws Exception {
        return ResponseEntity.ok(billService.cancelCard(userId, billId));
    }
}
