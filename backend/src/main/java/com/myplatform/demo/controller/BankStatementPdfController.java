package com.myplatform.demo.controller;


import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.RibPdfGeneratorService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/bankstatement/")
@CrossOrigin(origins = "http://localhost:4200")
public class BankStatementPdfController {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RibPdfGeneratorService ribPdfGeneratorService;


    @GetMapping("rib/pdf")
    public ResponseEntity<byte[]> generateRIB(@RequestParam Long userId) throws Exception {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        byte[] pdf = ribPdfGeneratorService.generatePdf(user.getBankAccountNumber());

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_PDF);
        headers.setContentDisposition(ContentDisposition.inline().filename("rib.pdf").build());

        return new ResponseEntity<>(pdf, headers, HttpStatus.OK);
    }
}
