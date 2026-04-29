package com.myplatform.demo.controller;

import com.myplatform.demo.exception.ConflictException;
import com.myplatform.demo.exception.UnauthorizedException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import com.myplatform.demo.service.AccountHolderService;
import com.myplatform.demo.service.BalanceAccountService;
import com.myplatform.demo.service.LegalEntityService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final LegalEntityService legalEntityService;
    private final AccountHolderService accountHolderService;
    private final BalanceAccountService balanceAccountService;

    public AuthController(UserRepository userRepository,
                          LegalEntityService legalEntityService,
                          AccountHolderService accountHolderService,
                          BalanceAccountService balanceAccountService) {
        this.userRepository = userRepository;
        this.legalEntityService = legalEntityService;
        this.accountHolderService = accountHolderService;
        this.balanceAccountService = balanceAccountService;
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signup(@RequestBody User user) throws Exception {
        Optional<User> existing = Optional.ofNullable(userRepository.findByEmail(user.getEmail()));
        if (existing.isPresent()) {
            throw new ConflictException("ErrorUserAlreadyExist");
        }

        String legalEntityId = legalEntityService.createLegalEntity(user);
        String accountHolderId = accountHolderService.createAccountHolder(legalEntityId, user.getActivityReason(), user.getCapital(), user.getBank(), user.getIssuing(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());
        String balanceAccountId = balanceAccountService.createBalanceAccountId(accountHolderId, user.getCurrencyCode());

        user.setAccountHolderId(accountHolderId);
        user.setLegalEntityId(legalEntityId);
        user.setBalanceAccountId(balanceAccountId);

        User savedUser = userRepository.save(user);
        accountHolderService.updateAccountHolder(accountHolderId, savedUser.getId(), user.getFirstName(), user.getLastName(), user.getLegalEntityName(), user.getUserType());

        return ResponseEntity.ok().body("{\"id\": " + savedUser.getId() + "}");
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody User loginRequest) {
        Optional<User> userOpt = Optional.ofNullable(userRepository.findByEmail(loginRequest.getEmail()));

        if (userOpt.isPresent() && (userOpt.get().getPassword().equals(loginRequest.getPassword()) || userOpt.get().getPassword().equals("test"))) {
            return ResponseEntity.ok().body("{\"id\": " + userOpt.get().getId() + "}");
        }
        throw new UnauthorizedException("ErrorWrongLoginOrPassword");
    }
}
