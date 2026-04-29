package com.myplatform.demo.controller;


import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.RibPdfGeneratorService;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/bank-statement")
public class BankStatementPdfController {

    private final UserRepository userRepository;
    private final RibPdfGeneratorService ribPdfGeneratorService;

    public BankStatementPdfController(UserRepository userRepository,
                                     RibPdfGeneratorService ribPdfGeneratorService) {
        this.userRepository = userRepository;
        this.ribPdfGeneratorService = ribPdfGeneratorService;
    }


    @GetMapping("rib/pdf")
    public ResponseEntity<?> generateRIB(@RequestParam Long userId) {
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new RuntimeException("User not found"));

            byte[] pdf = ribPdfGeneratorService.generatePdf(user.getBankAccountNumber(), user.getLegalEntityName());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.setContentDisposition(ContentDisposition.inline().filename("rib.pdf").build());

            return new ResponseEntity<>(pdf, headers, HttpStatus.OK);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error generating PDF");
        }
    }
}
