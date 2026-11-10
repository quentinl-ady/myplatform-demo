package com.myplatform.demo.util;

import com.adyen.model.legalentitymanagement.Address;
import com.adyen.model.legalentitymanagement.Organization;
import com.adyen.model.legalentitymanagement.PhoneNumber;
import com.adyen.model.legalentitymanagement.SoleProprietorship;
import com.myplatform.demo.dto.CompanyRecordDTO;
import com.myplatform.demo.model.CountryKycData;

import java.util.List;

/**
 * The company record imported at sign-up for a business of a country. Its values are the test data Adyen
 * already accepts, so the legal entity is created complete at sign-up and the hosted onboarding only
 * asks for the rest.
 */
public final class CompanyRecord {

    private CompanyRecord() {
    }

    /** Individuals have no company record to import. */
    public static boolean isAvailableFor(String userType) {
        return "organization".equals(userType) || "soleProprietorship".equals(userType);
    }

    public static CompanyRecordDTO preview(CountryKycData data) {
        return new CompanyRecordDTO(data.countryCode,
                "Private company",
                PostalAddress.lines(List.of(data.street), data.postalCode, data.city, data.stateOrProvince, data.countryCode),
                data.registrationNumber,
                data.vatNumber,
                data.phone);
    }

    public static Organization organization(String legalName, CountryKycData data) {
        return new Organization()
                .legalName(legalName)
                .type(Organization.TypeEnum.PRIVATECOMPANY)
                .registeredAddress(registeredOffice(data))
                .principalPlaceOfBusiness(registeredOffice(data))
                .registrationNumber(data.registrationNumber)
                .vatNumber(data.vatNumber)
                .phone(phone(data));
    }

    public static SoleProprietorship soleProprietorship(String name, CountryKycData data) {
        return new SoleProprietorship()
                .name(name)
                .countryOfGoverningLaw(data.countryCode)
                .registeredAddress(registeredOffice(data))
                .registrationNumber(data.registrationNumber)
                .vatNumber(data.vatNumber);
    }

    public static PhoneNumber phone(CountryKycData data) {
        return new PhoneNumber().type("mobile").number(data.phone);
    }

    private static Address registeredOffice(CountryKycData data) {
        return new Address()
                .street(data.street)
                .postalCode(data.postalCode)
                .city(data.city)
                .stateOrProvince(data.stateOrProvince)
                .country(data.countryCode);
    }
}
