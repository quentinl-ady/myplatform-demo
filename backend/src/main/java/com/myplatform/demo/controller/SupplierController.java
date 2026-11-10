package com.myplatform.demo.controller;

import com.myplatform.demo.dto.SupplierDTO;
import com.myplatform.demo.dto.SupplierRequest;
import com.myplatform.demo.service.SupplierService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** The suppliers the user pays bills to. */
@RestController
@RequestMapping("/api/suppliers")
public class SupplierController {

    private final SupplierService supplierService;

    public SupplierController(SupplierService supplierService) {
        this.supplierService = supplierService;
    }

    public record VerifiedNameRequest(String name) {
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<SupplierDTO>> list(@PathVariable String userId) {
        return ResponseEntity.ok(supplierService.list(userId));
    }

    @PostMapping("/{userId}")
    public ResponseEntity<SupplierDTO> create(@PathVariable String userId, @RequestBody SupplierRequest request) {
        return ResponseEntity.ok(supplierService.create(userId, request));
    }

    @PutMapping("/{userId}/{supplierId}")
    public ResponseEntity<SupplierDTO> update(@PathVariable String userId, @PathVariable Long supplierId,
                                              @RequestBody SupplierRequest request) {
        return ResponseEntity.ok(supplierService.update(userId, supplierId, request));
    }

    /** Takes the name the supplier's bank returned after a partial match of the Verification of Payee. */
    @PutMapping("/{userId}/{supplierId}/verified-name")
    public ResponseEntity<SupplierDTO> useVerifiedName(@PathVariable String userId, @PathVariable Long supplierId,
                                                       @RequestBody VerifiedNameRequest request) {
        return ResponseEntity.ok(supplierService.useVerifiedName(userId, supplierId, request != null ? request.name() : null));
    }

    /** Only a supplier without bills can be deleted. */
    @DeleteMapping("/{userId}/{supplierId}")
    public ResponseEntity<Void> delete(@PathVariable String userId, @PathVariable Long supplierId) {
        supplierService.delete(userId, supplierId);
        return ResponseEntity.noContent().build();
    }
}
