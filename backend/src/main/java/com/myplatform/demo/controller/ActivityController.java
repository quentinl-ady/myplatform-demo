package com.myplatform.demo.controller;

import com.myplatform.demo.exception.BadRequestException;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.Activity;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.LegalEntityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/activities")
public class ActivityController {

    private final UserRepository userRepository;
    private final LegalEntityService legalEntityService;

    public ActivityController(UserRepository userRepository,
                              LegalEntityService legalEntityService) {
        this.userRepository = userRepository;
        this.legalEntityService = legalEntityService;
    }

    @PostMapping("/{userId}")
    public ResponseEntity<Activity> createActivity(@PathVariable Long userId, @RequestBody Activity activity) throws Exception {
        User user = findUserWithLegalEntity(userId);
        return ResponseEntity.ok(legalEntityService.createBusinessLine(activity, user.getLegalEntityId()));
    }

    @GetMapping("/{userId}")
    public ResponseEntity<List<Activity>> getActivities(@PathVariable Long userId) throws Exception {
        User user = findUserWithLegalEntity(userId);
        return ResponseEntity.ok(legalEntityService.getBusinessLines(user.getLegalEntityId()));
    }

    private User findUserWithLegalEntity(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        if (user.getLegalEntityId() == null) {
            throw new BadRequestException("User has no legalEntityId");
        }
        return user;
    }
}
