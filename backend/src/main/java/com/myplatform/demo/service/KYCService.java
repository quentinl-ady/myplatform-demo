package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.legalentitymanagement.*;
import com.adyen.model.legalentitymanagement.Address;
import com.adyen.model.legalentitymanagement.Name;
import com.adyen.model.legalentitymanagement.PhoneNumber;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.*;
import com.myplatform.demo.model.CountryKycData;
import com.myplatform.demo.util.DocumentUtil;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.List;

import static com.myplatform.demo.util.DocumentUtil.loadResource;

@Service
public class KYCService {

    private final LegalEntitiesApi lem;
    private final DocumentsApi documentsApi;
    private final TermsOfServiceApi termsOfServiceApi;
    private final PciQuestionnairesApi pciQuestionnairesApi;

    public KYCService(@Qualifier("lemClient") Client lemClient,
                      @Value("${adyen.lemVersion}") String lemVersion) {
        lem = new LegalEntitiesApi(lemClient, "https://kyc-test.adyen.com/lem/" + lemVersion);
        documentsApi = new DocumentsApi(lemClient);
        termsOfServiceApi = new TermsOfServiceApi(lemClient);
        pciQuestionnairesApi = new PciQuestionnairesApi(lemClient);
    }

    public String createIndividualLegalEntity(Address address, TaxInformation taxInformation, PhoneNumber phoneNumber, String countryCode) throws IOException, ApiException {
        Individual individual = buildIndividual(address, taxInformation, phoneNumber, countryCode);

        LegalEntity legalEntity = lem.createLegalEntity(
                new LegalEntityInfoRequiredType()
                        .type(LegalEntityInfoRequiredType.TypeEnum.INDIVIDUAL)
                        .individual(individual)
        );

        uploadDocumentWithResource(legalEntity.getId(), Document.TypeEnum.PASSPORT, "passport.png", "Documents and live photo captured", "sample_driving_licence_back");

        uploadDocumentWithResource(legalEntity.getId(), Document.TypeEnum.LIVESELFIE, "sample_driving_licence_back.png", "live-selfie", "sample_driving_licence_back");

        return legalEntity.getId();
    }

    private Individual buildIndividual(Address address, TaxInformation taxInformation, PhoneNumber phoneNumber, String countryCode) {
        Individual individual = new Individual()
                .phone(phoneNumber)
                .residentialAddress(address)
                .name(new Name().firstName("Jean").lastName("Does"))
                .birthData(new BirthData().dateOfBirth("1990-06-21"))
                .email("jean.does@gmail.com")
                .addTaxInformationItem(taxInformation);

        if ("US".equals(countryCode)) {
            individual.setIdentificationData(new IdentificationData()
                    .type(IdentificationData.TypeEnum.NATIONALIDNUMBER)
                    .number("6789"));
        }
        return individual;
    }

    private void uploadDocument(String legalEntityId, Document.TypeEnum type, String description) throws IOException, ApiException {
        Document doc = new Document()
                .type(type)
                .description(description)
                .attachment(new Attachment().content(DocumentUtil.generateBase64EmptyPdf().getBytes()))
                .owner(new OwnerEntity().id(legalEntityId).type("legalEntity"));

        documentsApi.uploadDocumentForVerificationChecks(doc);
    }

    private void uploadDocumentWithResource(String legalEntityId, Document.TypeEnum type, String fileName, String description, String resourceName) throws IOException, ApiException {
        Document doc = new Document()
                .type(type)
                .fileName(fileName)
                .description(description)
                .attachment(new Attachment().content(loadResource(resourceName).getBytes()))
                .owner(new OwnerEntity().id(legalEntityId).type("legalEntity"));

        documentsApi.uploadDocumentForVerificationChecks(doc);
    }

    public void validateKyc(String legalEntityId, String userType, String countryCode) throws IOException, ApiException {
        CountryKycData countryData = CountryKycData.fromCode(countryCode);
        Address address = buildAddress(countryData);
        PhoneNumber phoneNumber = buildPhoneNumber(countryData);
        TaxInformation taxIndiv = buildTaxInformationIndiv(countryData);
        TaxInformation taxOrg = buildTaxInformationOrg(countryData);

        switch (userType) {
            case "organization" -> handleOrganizationKyc(legalEntityId, address, countryData, phoneNumber, taxIndiv, taxOrg);
            case "individual" -> handleIndividualKyc(legalEntityId, address, phoneNumber, taxIndiv);
            case "soleProprietorship" -> handleSoleProprietorshipKyc(legalEntityId, address, countryData, phoneNumber, taxIndiv);
            default -> throw new IllegalArgumentException("Unknown user type: " + userType);
        }
    }

    private Address buildAddress(CountryKycData data) {
        Address address = new Address().country(data.countryCode).street(data.street).city(data.city).postalCode(data.postalCode);

        if("US".equals(data.countryCode)){
            address.setStateOrProvince(data.stateOrProvince);
        }
        return address;
    }

    private PhoneNumber buildPhoneNumber(CountryKycData data) {
        return new PhoneNumber().type("mobile").number(data.phone);
    }

    private TaxInformation buildTaxInformationIndiv(CountryKycData data) {
        TaxInformation tax = new TaxInformation().country(data.countryCode).number(data.taxNumberIndividual);
        if ("US".equals(data.countryCode)) tax.setType("SSN");
        if ("GB".equals(data.countryCode)) tax.setType("NINO");
        return tax;
    }

    private TaxInformation buildTaxInformationOrg(CountryKycData data) {
        TaxInformation tax = new TaxInformation();
        tax.setCountry(data.countryCode);
        tax.setNumber(data.taxNumberOrganization);
        if ("FR".equals(data.countryCode)) tax.setType("SIRET");
        return tax;
    }

    private void handleIndividualKyc(String legalEntityId, Address address, PhoneNumber phoneNumber, TaxInformation taxInformation) throws IOException, ApiException {
        Individual individual = buildIndividual(address, taxInformation, phoneNumber, address.getCountry());
        lem.updateLegalEntity(legalEntityId, new LegalEntityInfo().individual(individual));
        uploadDocument(legalEntityId, Document.TypeEnum.PASSPORT, "passport");
    }

    private void handleOrganizationKyc(String legalEntityId, Address address, CountryKycData countryData, PhoneNumber phoneNumber, TaxInformation taxIndiv, TaxInformation taxOrg) throws IOException, ApiException {
        String uboLegalEntityId = createIndividualLegalEntity(address, taxIndiv, phoneNumber, countryData.countryCode);

        Organization organization = new Organization()
                .principalPlaceOfBusiness(address)
                .registrationNumber(countryData.registrationNumber)
                .doingBusinessAsAbsent(Boolean.TRUE)
                .vatNumber(countryData.vatNumber)
                .type(Organization.TypeEnum.PRIVATECOMPANY)
                .taxReportingClassification(new TaxReportingClassification()
                        .businessType(TaxReportingClassification.BusinessTypeEnum.OTHER)
                        .mainSourceOfIncome(TaxReportingClassification.MainSourceOfIncomeEnum.BUSINESSOPERATION)
                        .type(TaxReportingClassification.TypeEnum.NONFINANCIALACTIVE))
                .email("org.submerchant@gmail.com")
                .support(new Support()
                        .email("org.submerchant@gmail.com")
                        .phone(phoneNumber))
                .registeredAddress(address);

        if (List.of("NL", "DE", "FR").contains(countryData.countryCode)) {
            organization.addTaxInformationItem(taxOrg);
            organization.addFinancialReportsItem(new FinancialReport()
                    .annualTurnover("100000")
                    .currencyOfFinancialData("EUR"));
        }

        LegalEntityInfo legalEntityInfo = new LegalEntityInfo().organization(organization)
                .addEntityAssociationsItem(new LegalEntityAssociation().type(LegalEntityAssociation.TypeEnum.UBOTHROUGHCONTROL).legalEntityId(uboLegalEntityId).jobTitle("CEO"))
                .addEntityAssociationsItem(new LegalEntityAssociation().type(LegalEntityAssociation.TypeEnum.UBOTHROUGHOWNERSHIP).legalEntityId(uboLegalEntityId).jobTitle("CEO"))
                .addEntityAssociationsItem(new LegalEntityAssociation().type(LegalEntityAssociation.TypeEnum.SIGNATORY).legalEntityId(uboLegalEntityId).jobTitle("CEO"));

        lem.updateLegalEntity(legalEntityId, legalEntityInfo);
        uploadDocument(legalEntityId, Document.TypeEnum.REGISTRATIONDOCUMENT, "registrationDocument");
    }

    private void handleSoleProprietorshipKyc(String legalEntityId, Address address, CountryKycData countryData, PhoneNumber phoneNumber, TaxInformation taxIndiv) throws IOException, ApiException {
        String legalEntityIdSole = lem.getLegalEntity(legalEntityId).getEntityAssociations().get(0).getLegalEntityId();

        SoleProprietorship sole = new SoleProprietorship()
                .name("MySoloCorp")
                .countryOfGoverningLaw(countryData.countryCode)
                .vatNumber(countryData.vatNumber)
                .registrationNumber(countryData.registrationNumber)
                .registeredAddress(address);

        lem.updateLegalEntity(legalEntityIdSole, new LegalEntityInfo().soleProprietorship(sole));
        uploadDocument(legalEntityIdSole, Document.TypeEnum.REGISTRATIONDOCUMENT, "registrationDocument");

        Individual individual = buildIndividual(address, taxIndiv, phoneNumber, countryData.countryCode);
        lem.updateLegalEntity(legalEntityId, new LegalEntityInfo().individual(individual));
        uploadDocument(legalEntityId, Document.TypeEnum.PASSPORT, "passport");
    }

    public void signDocument(String legalEntityId, String userType, String activityReason, Boolean capital, Boolean bank, Boolean issuing) throws IOException, ApiException {

        String acceptedById = "";
        if ("organization".equals(userType)) {
            acceptedById = lem.getLegalEntity(legalEntityId).getEntityAssociations().get(0).getLegalEntityId();
        }
        if ("individual".equals(userType) || "soleProprietorship".equals(userType)) {
            acceptedById = legalEntityId;
        }

        acceptTerms(legalEntityId, acceptedById, GetTermsOfServiceDocumentRequest.TypeEnum.ADYENFORPLATFORMSADVANCED);

        if (List.of("organization", "soleProprietorship").contains(userType) && "embeddedPayment".equals(activityReason)) {
            signPciQuestionnaire(legalEntityId, acceptedById);
        }

        if (Boolean.TRUE.equals(capital)) acceptTerms(legalEntityId, acceptedById, GetTermsOfServiceDocumentRequest.TypeEnum.ADYENCAPITAL);
        if (Boolean.TRUE.equals(bank)) acceptTerms(legalEntityId, acceptedById, GetTermsOfServiceDocumentRequest.TypeEnum.ADYENACCOUNT);
        if (Boolean.TRUE.equals(issuing)) acceptTerms(legalEntityId, acceptedById, GetTermsOfServiceDocumentRequest.TypeEnum.ADYENCARD);
    }

    private void acceptTerms(String legalEntityId, String acceptedBy, GetTermsOfServiceDocumentRequest.TypeEnum type) throws IOException, ApiException {
        GetTermsOfServiceDocumentRequest request = new GetTermsOfServiceDocumentRequest().type(type).language("en");
        GetTermsOfServiceDocumentResponse response = termsOfServiceApi.getTermsOfServiceDocument(legalEntityId, request);
        termsOfServiceApi.acceptTermsOfService(legalEntityId, response.getTermsOfServiceDocumentId(), new AcceptTermsOfServiceRequest().acceptedBy(acceptedBy));
    }

    private void signPciQuestionnaire(String legalEntityId, String signedBy) throws IOException, ApiException {
        GeneratePciDescriptionRequest pciRequest = new GeneratePciDescriptionRequest()
                .addAdditionalSalesChannelsItem(GeneratePciDescriptionRequest.AdditionalSalesChannelsEnum.ECOMMERCE)
                .addAdditionalSalesChannelsItem(GeneratePciDescriptionRequest.AdditionalSalesChannelsEnum.POS)
                .language("en");

        GeneratePciDescriptionResponse pciResponse = pciQuestionnairesApi.generatePciQuestionnaire(legalEntityId, pciRequest);
        if (!pciResponse.getPciTemplateReferences().isEmpty()) {
            pciQuestionnairesApi.signPciQuestionnaire(legalEntityId, new PciSigningRequest()
                    .signedBy(signedBy)
                    .pciTemplateReferences(pciResponse.getPciTemplateReferences()));
        }
    }

}
