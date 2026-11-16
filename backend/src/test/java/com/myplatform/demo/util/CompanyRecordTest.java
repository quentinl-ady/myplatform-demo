package com.myplatform.demo.util;

import com.adyen.model.legalentitymanagement.Address;
import com.adyen.model.legalentitymanagement.Organization;
import com.adyen.model.legalentitymanagement.SoleProprietorship;
import com.myplatform.demo.dto.CompanyRecordDTO;
import com.myplatform.demo.model.CountryKycData;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CompanyRecordTest {

    @Test
    void thePreviewPrintsTheRegisteredOfficeInThePostalOrderOfItsCountry() {
        CompanyRecordDTO france = CompanyRecord.preview(CountryKycData.FR);
        CompanyRecordDTO us = CompanyRecord.preview(CountryKycData.US);

        assertThat(france.country()).isEqualTo("FR");
        assertThat(france.address()).containsExactly("6 Bd Haussmann", "75009 Paris", "France");
        assertThat(france.registrationNumber()).isEqualTo(CountryKycData.FR.registrationNumber);
        assertThat(france.vatNumber()).isEqualTo(CountryKycData.FR.vatNumber);
        assertThat(france.phone()).isEqualTo(CountryKycData.FR.phone);
        assertThat(us.address()).containsExactly("71 5th Avenue", "New York, NY 10003", "United States");
        assertThat(us.vatNumber()).isNull();
    }

    @Test
    void anImportedOrganizationIsCreatedWithItsWholeCompanyRecord() {
        Organization organization = CompanyRecord.organization("Acme SAS", CountryKycData.FR);
        Address office = organization.getRegisteredAddress();

        assertThat(organization.getLegalName()).isEqualTo("Acme SAS");
        assertThat(organization.getType()).isEqualTo(Organization.TypeEnum.PRIVATECOMPANY);
        assertThat(organization.getRegistrationNumber()).isEqualTo(CountryKycData.FR.registrationNumber);
        assertThat(organization.getVatNumber()).isEqualTo(CountryKycData.FR.vatNumber);
        assertThat(organization.getPhone().getNumber()).isEqualTo(CountryKycData.FR.phone);
        assertThat(office.getStreet()).isEqualTo("6 Bd Haussmann");
        assertThat(office.getPostalCode()).isEqualTo("75009");
        assertThat(office.getCity()).isEqualTo("Paris");
        assertThat(office.getCountry()).isEqualTo("FR");
        assertThat(office.getStateOrProvince()).isNull();
        assertThat(organization.getPrincipalPlaceOfBusiness()).isEqualTo(office).isNotSameAs(office);
    }

    @Test
    void aUsCompanyHasAStateAndNoVatNumber() {
        Organization organization = CompanyRecord.organization("Acme Inc.", CountryKycData.US);

        assertThat(organization.getRegisteredAddress().getStateOrProvince()).isEqualTo("NY");
        assertThat(organization.getVatNumber()).isNull();
    }

    @Test
    void anImportedSoleProprietorshipIsCreatedWithItsRegisteredOfficeAndNumbers() {
        SoleProprietorship business = CompanyRecord.soleProprietorship("Studio Jansen", CountryKycData.NL);

        assertThat(business.getName()).isEqualTo("Studio Jansen");
        assertThat(business.getCountryOfGoverningLaw()).isEqualTo("NL");
        assertThat(business.getRegistrationNumber()).isEqualTo(CountryKycData.NL.registrationNumber);
        assertThat(business.getVatNumber()).isEqualTo(CountryKycData.NL.vatNumber);
        assertThat(business.getRegisteredAddress().getCity()).isEqualTo("Amsterdam");
        assertThat(business.getRegisteredAddress().getPostalCode()).isEqualTo("1011DJ");
    }

    @Test
    void onlyBusinessesHaveACompanyRecordToImport() {
        assertThat(CompanyRecord.isAvailableFor("organization")).isTrue();
        assertThat(CompanyRecord.isAvailableFor("soleProprietorship")).isTrue();
        assertThat(CompanyRecord.isAvailableFor("individual")).isFalse();
        assertThat(CompanyRecord.isAvailableFor(null)).isFalse();
    }
}
