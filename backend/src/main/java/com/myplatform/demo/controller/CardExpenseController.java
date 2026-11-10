package com.myplatform.demo.controller;

import com.myplatform.demo.dto.CardExpenseDTO;
import com.myplatform.demo.dto.CardExpenseRequest;
import com.myplatform.demo.dto.CardExpenseSettingsDTO;
import com.myplatform.demo.dto.ReceiptUploadRequest;
import com.myplatform.demo.service.CardExpenseService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.List;

/** How the card payments are booked: their expense category, VAT, note and receipt. */
@RestController
@RequestMapping("/api/card-expenses")
public class CardExpenseController {

    private final CardExpenseService cardExpenseService;

    public CardExpenseController(CardExpenseService cardExpenseService) {
        this.cardExpenseService = cardExpenseService;
    }

    /** The categories, tax rates and receipt limits the expense form needs. */
    @GetMapping("/{userId}/settings")
    public ResponseEntity<CardExpenseSettingsDTO> settings(@PathVariable String userId) {
        return ResponseEntity.ok(cardExpenseService.settings(userId));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<CardExpenseDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(cardExpenseService.list(userId));
    }

    @PutMapping("/{userId}/{transferId}")
    public ResponseEntity<CardExpenseDTO> save(@PathVariable String userId, @PathVariable String transferId,
                                               @RequestBody CardExpenseRequest request) {
        return ResponseEntity.ok(cardExpenseService.save(userId, transferId, request));
    }

    @DeleteMapping("/{userId}/{transferId}")
    public ResponseEntity<Void> delete(@PathVariable String userId, @PathVariable String transferId) {
        cardExpenseService.delete(userId, transferId);
        return ResponseEntity.noContent().build();
    }

    /** A PDF or an image of 2 MB at most. */
    @PutMapping("/{userId}/{transferId}/receipt")
    public ResponseEntity<CardExpenseDTO> saveReceipt(@PathVariable String userId, @PathVariable String transferId,
                                                      @RequestBody ReceiptUploadRequest request) {
        return ResponseEntity.ok(cardExpenseService.saveReceipt(userId, transferId, request));
    }

    @GetMapping("/{userId}/{transferId}/receipt")
    public ResponseEntity<byte[]> receipt(@PathVariable String userId, @PathVariable String transferId) {
        CardExpenseService.ReceiptFile file = cardExpenseService.receipt(userId, transferId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(file.contentType()));
        headers.setContentDisposition(ContentDisposition.inline().filename(file.fileName(), StandardCharsets.UTF_8).build());
        headers.setCacheControl(CacheControl.noStore());
        headers.set("X-Content-Type-Options", "nosniff");
        return new ResponseEntity<>(file.content(), headers, HttpStatus.OK);
    }

    @DeleteMapping("/{userId}/{transferId}/receipt")
    public ResponseEntity<CardExpenseDTO> deleteReceipt(@PathVariable String userId, @PathVariable String transferId) {
        return ResponseEntity.ok(cardExpenseService.deleteReceipt(userId, transferId));
    }
}
