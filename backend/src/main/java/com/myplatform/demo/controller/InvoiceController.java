package com.myplatform.demo.controller;

import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceRequest;
import com.myplatform.demo.dto.InvoiceSettingsDTO;
import com.myplatform.demo.service.InvoiceService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Customer invoices, paid with Adyen payment links. */
@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    private final InvoiceService invoiceService;

    public InvoiceController(InvoiceService invoiceService) {
        this.invoiceService = invoiceService;
    }

    /** The currency, tax rates, payment terms and next number the invoice form needs. */
    @GetMapping("/{userId}/settings")
    public ResponseEntity<InvoiceSettingsDTO> settings(@PathVariable String userId) {
        return ResponseEntity.ok(invoiceService.settings(userId));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<InvoiceDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(invoiceService.list(userId));
    }

    @GetMapping("/{userId}/{invoiceId}")
    public ResponseEntity<InvoiceDTO> get(@PathVariable String userId, @PathVariable Long invoiceId) {
        return ResponseEntity.ok(invoiceService.get(userId, invoiceId));
    }

    /** Creates a draft. */
    @PostMapping("/{userId}")
    public ResponseEntity<InvoiceDTO> create(@PathVariable String userId, @RequestBody InvoiceRequest request) {
        return ResponseEntity.ok(invoiceService.create(userId, request));
    }

    /** Only a draft can be edited. */
    @PutMapping("/{userId}/{invoiceId}")
    public ResponseEntity<InvoiceDTO> update(@PathVariable String userId, @PathVariable Long invoiceId,
                                             @RequestBody InvoiceRequest request) {
        return ResponseEntity.ok(invoiceService.update(userId, invoiceId, request));
    }

    /** Issues the invoice with a payment link, or replaces the link that expired. */
    @PostMapping("/{userId}/{invoiceId}/send")
    public ResponseEntity<InvoiceDTO> send(@PathVariable String userId, @PathVariable Long invoiceId) throws Exception {
        return ResponseEntity.ok(invoiceService.send(userId, invoiceId));
    }

    @PostMapping("/{userId}/{invoiceId}/void")
    public ResponseEntity<InvoiceDTO> voidInvoice(@PathVariable String userId, @PathVariable Long invoiceId) throws Exception {
        return ResponseEntity.ok(invoiceService.voidInvoice(userId, invoiceId));
    }

    @GetMapping("/{userId}/{invoiceId}/pdf")
    public ResponseEntity<byte[]> pdf(@PathVariable String userId, @PathVariable Long invoiceId) {
        InvoiceService.InvoicePdf pdf = invoiceService.pdf(userId, invoiceId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.attachment().filename(pdf.fileName()).build());
        return new ResponseEntity<>(pdf.content(), headers, HttpStatus.OK);
    }
}
