package com.myplatform.demo.controller;

import com.myplatform.demo.dto.AccountStatementDTO;
import com.myplatform.demo.service.AccountStatementService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Account statements of the business account. */
@RestController
@RequestMapping("/api/statements")
public class AccountStatementController {

    private final AccountStatementService accountStatementService;

    public AccountStatementController(AccountStatementService accountStatementService) {
        this.accountStatementService = accountStatementService;
    }

    /** The latest statements, the most recent period first. */
    @GetMapping("/{userId}")
    public ResponseEntity<List<AccountStatementDTO>> getStatements(@PathVariable String userId) {
        return ResponseEntity.ok(accountStatementService.getStatements(userId));
    }

    /** The statement as a PDF, built from the CAMT.053 file Adyen generated. */
    @GetMapping("/{userId}/download")
    public ResponseEntity<byte[]> download(@PathVariable String userId, @RequestParam String fileName) {
        AccountStatementService.StatementPdf pdf = accountStatementService.downloadPdf(userId, fileName);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(pdf.fileName()).build());
        return new ResponseEntity<>(pdf.content(), headers, HttpStatus.OK);
    }
}
