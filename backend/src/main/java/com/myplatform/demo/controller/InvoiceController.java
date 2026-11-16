package com.myplatform.demo.controller;

import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.InvoiceRequest;
import com.myplatform.demo.dto.InvoiceSettingsDTO;
import com.myplatform.demo.dto.InvoiceTerminalDTO;
import com.myplatform.demo.dto.InvoiceTerminalRequest;
import com.myplatform.demo.dto.TerminalResultDTO;
import com.myplatform.demo.service.InvoiceService;
import com.myplatform.demo.service.InvoiceTerminalService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Customer invoices, paid with Adyen payment links or at the terminals of the stores. */
@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    private final InvoiceService invoiceService;
    private final InvoiceTerminalService invoiceTerminalService;

    public InvoiceController(InvoiceService invoiceService, InvoiceTerminalService invoiceTerminalService) {
        this.invoiceService = invoiceService;
        this.invoiceTerminalService = invoiceTerminalService;
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

    /** The terminals boarded in the stores of the user: they can collect and refund the payments of invoices. */
    @GetMapping("/{userId}/terminals")
    public ResponseEntity<List<InvoiceTerminalDTO>> terminals(@PathVariable String userId) {
        return ResponseEntity.ok(invoiceTerminalService.terminals(userId));
    }

    /** Collects the payment of the invoice at a terminal: answers once the terminal does, within 3 minutes. */
    @PostMapping("/{userId}/{invoiceId}/terminal-payment")
    public ResponseEntity<TerminalResultDTO> payAtTerminal(@PathVariable String userId, @PathVariable Long invoiceId,
                                                           @RequestBody InvoiceTerminalRequest request) {
        return ResponseEntity.ok(invoiceTerminalService.pay(userId, invoiceId, request.terminalId()));
    }

    /** Asks the terminal to stop waiting for the card: the pending payment then ends as cancelled. */
    @PostMapping("/{userId}/{invoiceId}/terminal-payment/cancel")
    public ResponseEntity<Void> cancelTerminalPayment(@PathVariable String userId, @PathVariable Long invoiceId) {
        invoiceTerminalService.cancel(userId, invoiceId);
        return ResponseEntity.accepted().build();
    }

    /** Refunds at a terminal what the refunds of the payment haven't given back yet. */
    @PostMapping("/{userId}/{invoiceId}/terminal-refund")
    public ResponseEntity<TerminalResultDTO> refundAtTerminal(@PathVariable String userId, @PathVariable Long invoiceId,
                                                              @RequestBody InvoiceTerminalRequest request) {
        return ResponseEntity.ok(invoiceTerminalService.refund(userId, invoiceId, request.terminalId()));
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
