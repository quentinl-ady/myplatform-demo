package com.myplatform.demo.controller;


import com.adyen.model.terminal.TerminalAPIResponse;
import com.myplatform.demo.model.PosPaymentRequest;
import com.myplatform.demo.model.PosPaymentResponse;
import com.myplatform.demo.service.IssuingService;
import com.myplatform.demo.service.PosService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@CrossOrigin(origins = "http://localhost:4200")
public class PosController {

    @Autowired
    private PosService posService;

    @PostMapping("/pos/pay")
    public ResponseEntity<PosPaymentResponse> makePayment(@RequestBody PosPaymentRequest posPaymentRequest) throws Exception {
        TerminalAPIResponse adyenResponse = posService.initiateSyncPayment(posPaymentRequest.getReference(), posPaymentRequest.getAmount(), posPaymentRequest.getCurrency(), posPaymentRequest.getTerminalId());
        PosPaymentResponse uiResponse = posService.mapTerminalResponse(adyenResponse);
        return ResponseEntity.ok(uiResponse);
    }
}
