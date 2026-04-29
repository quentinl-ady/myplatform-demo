package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.legalentitymanagement.*;
import com.adyen.model.legalentitymanagement.Address;
import com.adyen.model.legalentitymanagement.Name;
import com.adyen.service.exception.ApiException;
import com.adyen.service.legalentitymanagement.*;
import com.myplatform.demo.model.*;
import com.myplatform.demo.model.User;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;

@Service
public class LegalEntityService {

    private final LegalEntitiesApi lem;
    private final HostedOnboardingApi hop;
    private final BusinessLinesApi businessLinesApi;

    private static final Map<String, String> LANGUAGE_MAP = Map.of(
            "FR", "fr-FR",
            "DE", "de-DE",
            "NL", "nl-NL",
            "GB", "en-EN",
            "US", "en-US"
    );

    private final String frontendUrl;

    public LegalEntityService(@Qualifier("lemClient") Client lemClient,
                              @Value("${adyen.lemVersion}") String lemVersion,
                              @Value("${app.frontend.url}") String frontendUrl) {
        this.lem = new LegalEntitiesApi(lemClient, "https://kyc-test.adyen.com/lem/" + lemVersion);
        this.hop = new HostedOnboardingApi(lemClient);
        this.businessLinesApi = new BusinessLinesApi(lemClient);
        this.frontendUrl = frontendUrl;
    }

    public String createLegalEntity(User user) throws IOException, ApiException {
        Address address = new Address().country(user.getCountryCode());

        switch (user.getUserType()) {
            case "organization" -> {
                Organization organization = new Organization()
                        .legalName(user.getLegalEntityName())
                        .registeredAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .organization(organization)
                        .type(LegalEntityInfoRequiredType.TypeEnum.ORGANIZATION);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredType);
                return response.getId();
            }
            case "individual" -> {
                Individual individual = new Individual()
                        .name(new Name().firstName(user.getFirstName()).lastName(user.getLastName()))
                        .residentialAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .individual(individual)
                        .type(LegalEntityInfoRequiredType.TypeEnum.INDIVIDUAL);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredType);
                return response.getId();
            }
            case "soleProprietorship" -> {
                SoleProprietorship soleProprietorship = new SoleProprietorship()
                        .name(user.getLegalEntityName())
                        .countryOfGoverningLaw(user.getCountryCode())
                        .registeredAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredType = new LegalEntityInfoRequiredType()
                        .soleProprietorship(soleProprietorship)
                        .type(LegalEntityInfoRequiredType.TypeEnum.SOLEPROPRIETORSHIP);

                LegalEntity responseSoleProprietorship = lem.createLegalEntity(legalEntityInfoRequiredType);

                Individual individual = new Individual()
                        .name(new Name().firstName(user.getFirstName()).lastName(user.getLastName()))
                        .residentialAddress(address);

                LegalEntityInfoRequiredType legalEntityInfoRequiredTypeIndiv = new LegalEntityInfoRequiredType()
                        .individual(individual)
                        .addEntityAssociationsItem(new LegalEntityAssociation()
                                .type(LegalEntityAssociation.TypeEnum.SOLEPROPRIETORSHIP)
                                .legalEntityId(responseSoleProprietorship.getId()))
                        .type(LegalEntityInfoRequiredType.TypeEnum.INDIVIDUAL);

                LegalEntity response = lem.createLegalEntity(legalEntityInfoRequiredTypeIndiv);
                return response.getId();
            }
            default -> {
                return null;
            }
        }
    }

    public String createHOP(String legalEntityId, String countryCode, Long userId, String activityReason) throws IOException, ApiException {
        String languageCode = LANGUAGE_MAP.getOrDefault(countryCode.toUpperCase(), "en-US");

        OnboardingLinkSettings onboardingLinkSettings = new OnboardingLinkSettings();
        onboardingLinkSettings.setChangeLegalEntityType(false);
        if (activityReason.equals("embeddedPayment")) {
            onboardingLinkSettings.setRequirePciSignEcommerce(true);
            onboardingLinkSettings.setRequirePciSignPos(true);
        }

        OnboardingLinkInfo onboardingLinkInfo = new OnboardingLinkInfo()
                .locale(languageCode)
                .settings(onboardingLinkSettings)
                .redirectUrl(frontendUrl + "/" + userId + "/dashboard");

        OnboardingLink link = hop.getLinkToAdyenhostedOnboardingPage(legalEntityId, onboardingLinkInfo);
        return link.getUrl();
    }

    public KycStatus getLegalEntityKycDetail(String legalEntityId, String activityReason, Boolean bank, Boolean capital, Boolean issuing) throws IOException, ApiException {
        KycStatus kycStatus = new KycStatus();
        Status acquiring = new Status();
        Status payout = new Status();

        LegalEntity legalEntity = lem.getLegalEntity(legalEntityId);
        Map<String, LegalEntityCapability> map = legalEntity.getCapabilities();

        LegalEntityCapability acquiringCapability;
        if (activityReason.equals("embeddedPayment")) {
            acquiringCapability = map.get("receivePayments");
        } else {
            acquiringCapability = map.get("receiveFromPlatformPayments");
        }
        LegalEntityCapability sendToTransferInstrument = map.get("sendToTransferInstrument");

        if (bank) {
            LegalEntityCapability issueBankAccountCapability = map.get("issueBankAccount");
            Status issueBankAccount = new Status();
            issueBankAccount.setAllowed(issueBankAccountCapability.getAllowed());
            issueBankAccount.setVerificationStatus(issueBankAccountCapability.getVerificationStatus());
            kycStatus.setBankingStatus(issueBankAccount);
        }
        if (capital) {
            LegalEntityCapability receiveGrantsCapability = map.get("receiveGrants");
            Status receiveGrants = new Status();
            receiveGrants.setAllowed(receiveGrantsCapability.getAllowed());
            receiveGrants.setVerificationStatus(receiveGrantsCapability.getVerificationStatus());
            kycStatus.setCapitalStatus(receiveGrants);
        }
        if (issuing) {
            LegalEntityCapability issueCardCapability = map.get("issueCardCommercial");
            Status issueCard = new Status();
            issueCard.setAllowed(issueCardCapability.getAllowed());
            issueCard.setVerificationStatus(issueCardCapability.getVerificationStatus());
            kycStatus.setIssuingStatus(issueCard);
        }

        acquiring.setAllowed(acquiringCapability.getAllowed());
        acquiring.setVerificationStatus(acquiringCapability.getVerificationStatus());

        payout.setAllowed(sendToTransferInstrument.getAllowed());
        payout.setVerificationStatus(sendToTransferInstrument.getVerificationStatus());

        kycStatus.setAcquiringStatus(acquiring);
        kycStatus.setPayoutStatus(payout);

        return kycStatus;
    }

    public Activity createBusinessLine(Activity activity, String legalEntityId) throws IOException, ApiException {
        BusinessLineInfo businessLineInfo = new BusinessLineInfo()
                .legalEntityId(legalEntityId)
                .industryCode(activity.getIndustryCode())
                .salesChannels(activity.getSalesChannels())
                .addWebDataItem(new WebData().webAddress(frontendUrl))
                .service(BusinessLineInfo.ServiceEnum.PAYMENTPROCESSING);

        BusinessLine businessLine = businessLinesApi.createBusinessLine(businessLineInfo);
        activity.setId(businessLine.getId());
        return activity;
    }

    public List<Activity> getBusinessLines(String legalEntityId) throws IOException, ApiException {
        List<BusinessLine> businessLines =
                lem.getAllBusinessLinesUnderLegalEntity(legalEntityId).getBusinessLines();

        if (businessLines == null || businessLines.isEmpty()) {
            return List.of();
        }

        return businessLines.stream()
                .filter(businessLine -> "paymentProcessing".equals(businessLine.getService().getValue()))
                .map(businessLine -> {
                    Activity activity = new Activity();
                    activity.setId(businessLine.getId());
                    activity.setIndustryCode(businessLine.getIndustryCode());
                    if (businessLine.getSalesChannels() != null) {
                        activity.setSalesChannels(businessLine.getSalesChannels());
                    }
                    return activity;
                })
                .toList();
    }

    public List<PayoutAccount> getPayoutAccounts(String legalEntityId) throws IOException, ApiException {
        LegalEntity legalEntity = lem.getLegalEntity(legalEntityId);

        List<TransferInstrumentReference> transferInstruments =
                Optional.ofNullable(legalEntity.getTransferInstruments())
                        .orElse(Collections.emptyList());

        return transferInstruments.stream()
                .filter(Objects::nonNull)
                .map(ref -> new PayoutAccount(ref.getId(), ref.getAccountIdentifier()))
                .toList();
    }
}
