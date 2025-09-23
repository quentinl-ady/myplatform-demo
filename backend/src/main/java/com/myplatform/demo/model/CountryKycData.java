package com.myplatform.demo.model;

import java.util.Arrays;

public enum CountryKycData {

    FR("FR", "54205118000066", "FR12345678901", "6 Bd Haussmann", "Paris", "75009",null, "+33600000000", "3023217600053", null),
    US("US", "101002749", null, "71 5th Avenue", "New York", "10003","NY", "+14153671502", "123-45-6789", "12-3456789"),
    GB("GB", "AB012345", "GB1234567890", "12-13 Wells Mews", "London", "W1T3HE",null, "+14153671502", "AB123456C", "01234567"),
    DE("DE", "HRB12345", "DE115235681", "Jägerstraße 27", "Berlin", "10117",null, "+14153671502", "58791092934", "1234567890"),
    NL("NL", "34179503", "NL123456789B01", "Simon Carmiggeltstraat 6 - 50", "Amsterdam","1011DJ", null, "+14153671502", "962702183", "123456789");

    public final String countryCode;
    public final String registrationNumber;
    public final String vatNumber;
    public final String street;
    public final String city;
    public final String postalCode;
    public final String stateOrProvince;
    public final String phone;
    public final String taxNumberIndividual;
    public final String taxNumberOrganization;

    CountryKycData(String countryCode, String registrationNumber, String vatNumber, String street, String city, String postalCode, String stateOrProvince, String phone, String taxNumberIndividual, String taxNumberOrganization) {
        this.countryCode = countryCode;
        this.registrationNumber = registrationNumber;
        this.vatNumber = vatNumber;
        this.street = street;
        this.city = city;
        this.postalCode = postalCode;
        this.stateOrProvince = stateOrProvince;
        this.phone = phone;
        this.taxNumberIndividual = taxNumberIndividual;
        this.taxNumberOrganization = taxNumberOrganization;
    }

    public static CountryKycData fromCode(String code) {
        return Arrays.stream(values())
                .filter(c -> c.countryCode.equals(code))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown country code: " + code));
    }
}
