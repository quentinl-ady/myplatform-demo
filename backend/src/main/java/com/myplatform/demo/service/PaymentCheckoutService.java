package com.myplatform.demo.service;

import com.adyen.Client;
import com.adyen.model.checkout.*;
import com.adyen.model.checkout.Amount;
import com.adyen.model.recurring.DisableRequest;
import com.adyen.model.recurring.DisableResult;
import com.adyen.model.recurring.Recurring;
import com.adyen.model.recurring.RecurringDetail;
import com.adyen.model.recurring.RecurringDetailsRequest;
import com.adyen.model.recurring.RecurringDetailsResult;
import com.adyen.service.checkout.PaymentsApi;
import com.adyen.service.exception.ApiException;
import com.adyen.service.recurring.RecurringApi;
import com.myplatform.demo.dto.AdvancedPaymentOptions;
import com.myplatform.demo.dto.StoredPaymentMethodDTO;
import com.myplatform.demo.dto.TokenPaymentResponse;
import com.myplatform.demo.model.PaymentSessionResponse;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.repository.StoreCustomerRepository;
import com.myplatform.demo.util.PaymentResultRedirects;
import lombok.Getter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class PaymentCheckoutService {

    @Getter
    private final PaymentsApi paymentsApi;
    private final RecurringApi recurringApi;
    @Getter
    private final String merchantAccount;
    @Getter
    private final String clientKey;
    private final StoreCustomerRepository storeCustomerRepository;
    private final CheckoutPaymentService checkoutPaymentService;

    private final String backendUrl;

    public PaymentCheckoutService(@Qualifier("pspClient") Client pspClient,
                                  @Value("${adyen.merchantAccount}") String merchantAccount,
                                  @Value("${adyen.clientKey}") String clientKey,
                                  @Value("${app.backend.url}") String backendUrl,
                                  StoreCustomerRepository storeCustomerRepository,
                                  CheckoutPaymentService checkoutPaymentService) {
        this.paymentsApi = new PaymentsApi(pspClient);
        this.recurringApi = new RecurringApi(pspClient);
        this.merchantAccount = merchantAccount;
        this.clientKey = clientKey;
        this.backendUrl = backendUrl;
        this.storeCustomerRepository = storeCustomerRepository;
        this.checkoutPaymentService = checkoutPaymentService;
    }

    public PaymentSessionResponse createPaymentSession(String currencyCode, Long amount, String reference,
                                                       String userId, String storeRef, String activityReason,
                                                       String balanceAccountId, AdvancedPaymentOptions advancedOptions)
            throws IOException, ApiException {

        boolean embeddedPayment = "embeddedPayment".equals(activityReason);
        ResolvedPaymentOptions options = checkoutPaymentService.resolve(advancedOptions,
                target(userId, activityReason, balanceAccountId, embeddedPayment ? storeRef : null),
                amount, currencyCode, reference);

        ThreeDSRequestData threeDSRequestData = new ThreeDSRequestData()
                .nativeThreeDS(ThreeDSRequestData.NativeThreeDSEnum.PREFERRED);

        AuthenticationData authenticationData = new AuthenticationData()
                .threeDSRequestData(threeDSRequestData);

        LineItem lineItem = new LineItem();
        lineItem.setDescription("item toto");
        lineItem.setAmountIncludingTax(amount);
        lineItem.setQuantity(1L);

        String countryCode = "";
        if ("USD".equals(currencyCode)) {
            countryCode = "US";
        } else if ("EUR".equals(currencyCode)) {
            countryCode = "FR";
        } else if ("GBP".equals(currencyCode)) {
            countryCode = "GB";
        }

        CreateCheckoutSessionRequest createCheckoutSessionRequest = new CreateCheckoutSessionRequest()
                .storePaymentMethod(Boolean.FALSE)
                .recurringProcessingModel(CreateCheckoutSessionRequest.RecurringProcessingModelEnum.SUBSCRIPTION)
                .shopperReference("john.doe@gmail.com_" + storeRef)
                .authenticationData(authenticationData)
                .reference(reference)
                .merchantOrderReference(reference)
                .countryCode(countryCode)
                .shopperInteraction(CreateCheckoutSessionRequest.ShopperInteractionEnum.ECOMMERCE)
                .addLineItemsItem(lineItem)
                .amount(new Amount().currency(currencyCode).value(amount))
                .merchantAccount(this.merchantAccount)
                .channel(CreateCheckoutSessionRequest.ChannelEnum.WEB)
                .shopperEmail("john.doe@gmail.com")
                .shopperIP("192.168.1.1")
                .shopperName(new ShopperName().firstName("John").lastName("Doe"))
                .dateOfBirth(LocalDate.of(1990, 1, 1))
                .telephoneNumber("+33610101010")
                .returnUrl(PaymentResultRedirects.returnUrl(backendUrl + "/api/payments/redirect", userId,
                        PaymentResultRedirects.SOURCE_CHECKOUT, options.trackingId()));

        if (embeddedPayment) {
            createCheckoutSessionRequest.setStore(storeRef);
            StoreCustomer storeCustomer = this.storeCustomerRepository.findByStoreRef(storeRef);
            createCheckoutSessionRequest.setCountryCode(storeCustomer.getCountry());
        }
        options.applyTo(createCheckoutSessionRequest);

        CreateCheckoutSessionResponse response = paymentsApi.sessions(createCheckoutSessionRequest);

        PaymentSessionResponse paymentSessionResponse = new PaymentSessionResponse();
        paymentSessionResponse.setId(response.getId());
        paymentSessionResponse.setSessionData(response.getSessionData());
        paymentSessionResponse.setAmount(amount);
        paymentSessionResponse.setCurrency(currencyCode);
        paymentSessionResponse.setTrackingId(checkoutPaymentService.recordSession(options, response.getId()));
        return paymentSessionResponse;
    }

    private ResolvedPaymentOptions.Target target(String userId, String activityReason, String balanceAccountId,
                                                 String storeReference) {
        return new ResolvedPaymentOptions.Target(PaymentResultRedirects.SOURCE_CHECKOUT, merchantAccount,
                userId, userId, activityReason, balanceAccountId, storeReference);
    }

    public PaymentSessionResponse createTokenizationSession(String currencyCode, String reference,
                                                             String userId, String storeRef, String activityReason)
            throws IOException, ApiException {

        String shopperReference = "john.doe@gmail.com_" + storeRef;

        ThreeDSRequestData threeDSRequestData = new ThreeDSRequestData()
                .nativeThreeDS(ThreeDSRequestData.NativeThreeDSEnum.PREFERRED);

        AuthenticationData authenticationData = new AuthenticationData()
                .threeDSRequestData(threeDSRequestData);

        String countryCode = "";
        if ("USD".equals(currencyCode)) {
            countryCode = "US";
        } else if ("EUR".equals(currencyCode)) {
            countryCode = "FR";
        } else if ("GBP".equals(currencyCode)) {
            countryCode = "GB";
        }

        CreateCheckoutSessionRequest request = new CreateCheckoutSessionRequest()
                .storePaymentMethodMode(CreateCheckoutSessionRequest.StorePaymentMethodModeEnum.ENABLED)
                .recurringProcessingModel(CreateCheckoutSessionRequest.RecurringProcessingModelEnum.UNSCHEDULEDCARDONFILE)
                .shopperReference(shopperReference)
                .authenticationData(authenticationData)
                .reference(reference)
                .countryCode(countryCode)
                .shopperInteraction(CreateCheckoutSessionRequest.ShopperInteractionEnum.ECOMMERCE)
                .amount(new Amount().currency(currencyCode).value(0L))
                .merchantAccount(this.merchantAccount)
                .channel(CreateCheckoutSessionRequest.ChannelEnum.WEB)
                .shopperEmail("john.doe@gmail.com")
                .shopperIP("192.168.1.1")
                .shopperName(new ShopperName().firstName("John").lastName("Doe"))
                .dateOfBirth(LocalDate.of(1990, 1, 1))
                .telephoneNumber("+33610101010")
                .returnUrl(PaymentResultRedirects.returnUrl(backendUrl + "/api/payments/redirect", userId, PaymentResultRedirects.SOURCE_CHECKOUT));

        if ("embeddedPayment".equals(activityReason)) {
            request.setStore(storeRef);
            StoreCustomer storeCustomer = this.storeCustomerRepository.findByStoreRef(storeRef);
            request.setCountryCode(storeCustomer.getCountry());
        }

        CreateCheckoutSessionResponse response = paymentsApi.sessions(request);

        PaymentSessionResponse paymentSessionResponse = new PaymentSessionResponse();
        paymentSessionResponse.setId(response.getId());
        paymentSessionResponse.setSessionData(response.getSessionData());
        paymentSessionResponse.setAmount(0L);
        paymentSessionResponse.setCurrency(currencyCode);
        return paymentSessionResponse;
    }

    public List<StoredPaymentMethodDTO> listStoredPaymentMethods(String storeRef) throws IOException, ApiException {
        String shopperReference = "john.doe@gmail.com_" + storeRef;

        RecurringDetailsRequest request = new RecurringDetailsRequest();
        request.setMerchantAccount(this.merchantAccount);
        request.setShopperReference(shopperReference);

        Recurring recurring = new Recurring();
        recurring.setContract(Recurring.ContractEnum.RECURRING);
        request.setRecurring(recurring);

        RecurringDetailsResult result = recurringApi.listRecurringDetails(request);

        if (result.getDetails() == null || result.getDetails().isEmpty()) {
            return Collections.emptyList();
        }

        List<StoredPaymentMethodDTO> storedMethods = new ArrayList<>();
        for (var wrapper : result.getDetails()) {
            RecurringDetail detail = wrapper.getRecurringDetail();
            StoredPaymentMethodDTO dto = new StoredPaymentMethodDTO();
            dto.setRecurringDetailReference(detail.getRecurringDetailReference());
            dto.setType(detail.getVariant());
            dto.setCardBrand(detail.getVariant());

            if (detail.getCard() != null) {
                String number = detail.getCard().getNumber();
                dto.setCardSummary(number != null && number.length() >= 4
                        ? number.substring(number.length() - 4)
                        : number);
                dto.setExpiryMonth(detail.getCard().getExpiryMonth());
                dto.setExpiryYear(detail.getCard().getExpiryYear());
                dto.setHolderName(detail.getCard().getHolderName());
            }

            storedMethods.add(dto);
        }
        return storedMethods;
    }

    public TokenPaymentResponse makeTokenPayment(String currencyCode, Long amount, String reference,
                                                  String userId, String storeRef, String activityReason,
                                                  String balanceAccountId, String storedPaymentMethodId,
                                                  String type, AdvancedPaymentOptions advancedOptions)
            throws IOException, ApiException {

        boolean embeddedPayment = "embeddedPayment".equals(activityReason);
        ResolvedPaymentOptions options = checkoutPaymentService.resolve(advancedOptions,
                target(userId, activityReason, balanceAccountId, embeddedPayment ? storeRef : null),
                amount, currencyCode, reference);

        String shopperReference = "john.doe@gmail.com_" + storeRef;

        CheckoutPaymentMethod checkoutPaymentMethod;
        if ("sepadirectdebit".equals(type)) {
            SepaDirectDebitDetails sepaDetails = new SepaDirectDebitDetails();
            sepaDetails.setStoredPaymentMethodId(storedPaymentMethodId);
            sepaDetails.setType(SepaDirectDebitDetails.TypeEnum.SEPADIRECTDEBIT);
            checkoutPaymentMethod = new CheckoutPaymentMethod(sepaDetails);
        } else {
            CardDetails cardDetails = new CardDetails();
            cardDetails.setStoredPaymentMethodId(storedPaymentMethodId);
            checkoutPaymentMethod = new CheckoutPaymentMethod(cardDetails);
        }

        PaymentRequest paymentRequest = new PaymentRequest();
        paymentRequest.setAmount(new Amount().currency(currencyCode).value(amount));
        paymentRequest.setMerchantAccount(this.merchantAccount);
        paymentRequest.setReference(reference);
        paymentRequest.setShopperReference(shopperReference);
        paymentRequest.setShopperInteraction(PaymentRequest.ShopperInteractionEnum.CONTAUTH);
        paymentRequest.setRecurringProcessingModel(PaymentRequest.RecurringProcessingModelEnum.UNSCHEDULEDCARDONFILE);
        paymentRequest.setPaymentMethod(checkoutPaymentMethod);
        paymentRequest.setShopperEmail("john.doe@gmail.com");

        if (embeddedPayment) {
            paymentRequest.setStore(storeRef);
        }
        options.applyTo(paymentRequest);

        PaymentResponse response = paymentsApi.payments(paymentRequest);

        TokenPaymentResponse tokenPaymentResponse = new TokenPaymentResponse();
        tokenPaymentResponse.setPspReference(response.getPspReference());
        tokenPaymentResponse.setResultCode(response.getResultCode() != null ? response.getResultCode().getValue() : null);
        tokenPaymentResponse.setRefusalReason(response.getRefusalReason());
        tokenPaymentResponse.setTrackingId(checkoutPaymentService.recordTokenPayment(options, response));
        return tokenPaymentResponse;
    }

    public void disableStoredPaymentMethod(String storeRef, String recurringDetailReference) throws IOException, ApiException {
        String shopperReference = "john.doe@gmail.com_" + storeRef;

        DisableRequest disableRequest = new DisableRequest();
        disableRequest.setMerchantAccount(this.merchantAccount);
        disableRequest.setShopperReference(shopperReference);
        disableRequest.setRecurringDetailReference(recurringDetailReference);

        recurringApi.disable(disableRequest);
    }
}
