package com.myplatform.demo.controller;

import com.myplatform.demo.dto.InvoiceDTO;
import com.myplatform.demo.dto.TerminalContextDTO;
import com.myplatform.demo.dto.TerminalResultDTO;
import com.myplatform.demo.service.InvoiceTerminalService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The app that runs on the terminals of the stores: it collects and refunds the payments of the invoices of the user
 * the store belongs to. It has no login: the ID of the terminal identifies the store, and so the user.
 */
@RestController
@RequestMapping("/api/terminals/{terminalId}")
public class TerminalAppController {

    private final InvoiceTerminalService invoiceTerminalService;

    public TerminalAppController(InvoiceTerminalService invoiceTerminalService) {
        this.invoiceTerminalService = invoiceTerminalService;
    }

    /** The store of the terminal, and the business and currency of its invoices. */
    @GetMapping
    public ResponseEntity<TerminalContextDTO> context(@PathVariable String terminalId) {
        return ResponseEntity.ok(invoiceTerminalService.context(terminalId));
    }

    /** The sent, overdue and paid invoices, the latest first. */
    @GetMapping("/invoices")
    public ResponseEntity<List<InvoiceDTO>> invoices(@PathVariable String terminalId) {
        return ResponseEntity.ok(invoiceTerminalService.invoices(terminalId));
    }

    @GetMapping("/invoices/{invoiceId}")
    public ResponseEntity<InvoiceDTO> invoice(@PathVariable String terminalId, @PathVariable Long invoiceId) {
        return ResponseEntity.ok(invoiceTerminalService.invoice(terminalId, invoiceId));
    }

    /** Collects the payment of the invoice on this terminal: answers once the customer has paid, within 3 minutes. */
    @PostMapping("/invoices/{invoiceId}/payment")
    public ResponseEntity<TerminalResultDTO> pay(@PathVariable String terminalId, @PathVariable Long invoiceId) {
        return ResponseEntity.ok(invoiceTerminalService.collectAt(terminalId, invoiceId));
    }

    /** Refunds what the refunds of the payment haven't given back yet. */
    @PostMapping("/invoices/{invoiceId}/refund")
    public ResponseEntity<TerminalResultDTO> refund(@PathVariable String terminalId, @PathVariable Long invoiceId) {
        return ResponseEntity.ok(invoiceTerminalService.refundAt(terminalId, invoiceId));
    }
}
