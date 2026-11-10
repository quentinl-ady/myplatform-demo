package com.myplatform.demo.controller;

import com.myplatform.demo.dto.LedgerDTO;
import com.myplatform.demo.service.LedgerService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;

/** The accounting journal: invoices and movements of the balance accounts, matched. */
@RestController
@RequestMapping("/api/ledger")
public class LedgerController {

    private final LedgerService ledgerService;

    public LedgerController(LedgerService ledgerService) {
        this.ledgerService = ledgerService;
    }

    /** The journal of the last days: 30 by default, 90 at most. */
    @GetMapping("/{userId}")
    public ResponseEntity<LedgerDTO> ledger(@PathVariable String userId, @RequestParam(required = false) Integer days) {
        return ResponseEntity.ok(ledgerService.ledger(userId, days));
    }

    /** The journal as a CSV file, for accounting software. */
    @GetMapping("/{userId}/export")
    public ResponseEntity<byte[]> export(@PathVariable String userId, @RequestParam(required = false) Integer days) {
        LedgerService.JournalExport export = ledgerService.export(userId, days);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(new MediaType("text", "csv", StandardCharsets.UTF_8));
        headers.setContentDisposition(ContentDisposition.attachment().filename(export.fileName()).build());
        return new ResponseEntity<>(export.content(), headers, HttpStatus.OK);
    }
}
