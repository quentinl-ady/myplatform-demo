package com.myplatform.demo.controller;

import com.myplatform.demo.dto.DemoDataResult;
import com.myplatform.demo.service.DemoDataService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Fills an account with realistic data before a demo. */
@RestController
@RequestMapping("/api/demo-data")
public class DemoDataController {

    private final DemoDataService demoDataService;

    public DemoDataController(DemoDataService demoDataService) {
        this.demoDataService = demoDataService;
    }

    /** Creates what's missing: loading the demo data again doesn't duplicate it. */
    @PostMapping("/{userId}")
    public ResponseEntity<DemoDataResult> load(@PathVariable String userId) {
        return ResponseEntity.ok(demoDataService.load(userId));
    }
}
