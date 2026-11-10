package com.myplatform.demo.controller;

import com.myplatform.demo.dto.CustomerDTO;
import com.myplatform.demo.dto.CustomerRequest;
import com.myplatform.demo.service.CustomerService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** The customers the user invoices. */
@RestController
@RequestMapping("/api/customers")
public class CustomerController {

    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<CustomerDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(customerService.list(userId));
    }

    @PostMapping("/{userId}")
    public ResponseEntity<CustomerDTO> create(@PathVariable String userId, @RequestBody CustomerRequest request) {
        return ResponseEntity.ok(customerService.create(userId, request));
    }

    @PutMapping("/{userId}/{customerId}")
    public ResponseEntity<CustomerDTO> update(@PathVariable String userId, @PathVariable Long customerId,
                                              @RequestBody CustomerRequest request) {
        return ResponseEntity.ok(customerService.update(userId, customerId, request));
    }

    /** Only a customer without invoices can be deleted. */
    @DeleteMapping("/{userId}/{customerId}")
    public ResponseEntity<Void> delete(@PathVariable String userId, @PathVariable Long customerId) {
        customerService.delete(userId, customerId);
        return ResponseEntity.noContent().build();
    }
}
