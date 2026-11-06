package com.myplatform.demo.controller;


import com.adyen.model.clouddevice.CloudDeviceApiResponse;
import com.myplatform.demo.model.PosAbortRequest;
import com.myplatform.demo.model.PosPaymentRequest;
import com.myplatform.demo.model.PosPaymentResponse;
import com.myplatform.demo.service.PosService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class PosController {

    private final PosService posService;

    public PosController(PosService posService) {
        this.posService = posService;
    }

    @PostMapping("/api/pos/pay")
    public ResponseEntity<PosPaymentResponse> makePayment(@RequestBody PosPaymentRequest posPaymentRequest) throws Exception {
        CloudDeviceApiResponse adyenResponse = posService.initiateSyncPayment(posPaymentRequest.getReference(), posPaymentRequest.getAmount(), posPaymentRequest.getCurrency(), posPaymentRequest.getTerminalId(), posPaymentRequest.getServiceId());
        PosPaymentResponse uiResponse = posService.mapTerminalResponse(adyenResponse);
        return ResponseEntity.ok(uiResponse);
    }

    /**
     * Asks the terminal to cancel a pending payment. The outcome arrives on the pending /api/pos/pay call
     * (a failure with errorCondition "Aborted"), so this endpoint only confirms that the request was delivered.
     */
    @PostMapping("/api/pos/abort")
    public ResponseEntity<Map<String, String>> abortPayment(@RequestBody PosAbortRequest posAbortRequest) throws Exception {
        String rejection = posService.abortPayment(posAbortRequest.getTerminalId(), posAbortRequest.getServiceId());
        if (rejection != null) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", rejection));
        }
        return ResponseEntity.accepted().build();
    }
}
