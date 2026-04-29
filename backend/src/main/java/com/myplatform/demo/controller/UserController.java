package com.myplatform.demo.controller;

import com.myplatform.demo.dto.DTOMapper;
import com.myplatform.demo.dto.UserDTO;
import com.myplatform.demo.exception.ResourceNotFoundException;
import com.myplatform.demo.model.User;
import com.myplatform.demo.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;

    public UserController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/{userId}")
    public ResponseEntity<UserDTO> user(@PathVariable Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found"));
        return ResponseEntity.ok(DTOMapper.toUserDTO(user));
    }
}
