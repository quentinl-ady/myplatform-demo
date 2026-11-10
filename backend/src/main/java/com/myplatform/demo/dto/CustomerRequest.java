package com.myplatform.demo.dto;

/** A customer as the user enters it. Only the name, the email and the country are required. */
public record CustomerRequest(String name,
                              String company,
                              String email,
                              String country,
                              String vatNumber,
                              String addressLine,
                              String postalCode,
                              String city) {
}
