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
import com.myplatform.demo.dto.StoredPaymentMethodDTO;
import com.myplatform.demo.dto.TokenPaymentResponse;
import com.myplatform.demo.model.PaymentSessionResponse;
import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.repository.StoreCustomerRepository;
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
    private final String merchantAccount;
    @Getter
    private final String clientKey;
    private final StoreCustomerRepository storeCustomerRepository;

    private final String backendUrl;

    public PaymentCheckoutService(@Qualifier("pspClient") Client pspClient,
                                  @Value("${adyen.merchantAccount}") String merchantAccount,
                                  @Value("${adyen.clientKey}") String clientKey,
                                  @Value("${app.backend.url}") String backendUrl,
                                  StoreCustomerRepository storeCustomerRepository) {
        this.paymentsApi = new PaymentsApi(pspClient);
        this.recurringApi = new RecurringApi(pspClient);
        this.merchantAccount = merchantAccount;
        this.clientKey = clientKey;
        this.backendUrl = backendUrl;
        this.storeCustomerRepository = storeCustomerRepository;
    }

    public PaymentSessionResponse createPaymentSession(String currencyCode, Long amount, String reference,
                                                       String userId, String storeRef, String activityReason,
                                                       String balanceAccountId) throws IOException, ApiException {

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
                .captureDelayHours(0)
                .telephoneNumber("+33610101010")
                .returnUrl(backendUrl + "/api/payments/redirect");

        if (activityReason.equals("embeddedPayment")) {
            createCheckoutSessionRequest.setStore(storeRef);
            StoreCustomer storeCustomer = this.storeCustomerRepository.findByStoreRef(storeRef);
            createCheckoutSessionRequest.setCountryCode(storeCustomer.getCountry());
        } else if (activityReason.equals("marketplace")) {
            List<Split> splits = new ArrayList<>();

            long commissionAmount = Math.round(amount * 0.10);
            long sellerAmount = amount - commissionAmount;

            Split sellerSplit = new Split();
            sellerSplit.setAmount(new SplitAmount().currency(currencyCode).value(sellerAmount));
            sellerSplit.setType(Split.TypeEnum.BALANCEACCOUNT);
            sellerSplit.setAccount(balanceAccountId);
            sellerSplit.setReference("SELLER_" + reference);

            Split platformSplit = new Split();
            platformSplit.setAmount(new SplitAmount().currency(currencyCode).value(commissionAmount));
            platformSplit.setType(Split.TypeEnum.COMMISSION);
            platformSplit.setReference("PLATFORM_FEE_" + reference);

            splits.add(sellerSplit);
            splits.add(platformSplit);

            createCheckoutSessionRequest.setSplits(splits);

            long totalSplits = splits.stream().mapToLong(s -> s.getAmount().getValue()).sum();
            if (totalSplits != amount) {
                throw new IllegalStateException("The sum of the splits (" + totalSplits + ") does not match the total amount (" + amount + ")");
            }
        }

        CreateCheckoutSessionResponse response = paymentsApi.sessions(createCheckoutSessionRequest);

        PaymentSessionResponse paymentSessionResponse = new PaymentSessionResponse();
        paymentSessionResponse.setId(response.getId());
        paymentSessionResponse.setSessionData(response.getSessionData());
        paymentSessionResponse.setAmount(amount);
        paymentSessionResponse.setCurrency(currencyCode);
        return paymentSessionResponse;
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
                .returnUrl(backendUrl + "/api/payments/redirect");

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
                                                  String storeRef, String activityReason,
                                                  String balanceAccountId, String storedPaymentMethodId)
            throws IOException, ApiException {

        String shopperReference = "john.doe@gmail.com_" + storeRef;

        CardDetails cardDetails = new CardDetails();
        cardDetails.setStoredPaymentMethodId(storedPaymentMethodId);

        PaymentRequest paymentRequest = new PaymentRequest();
        paymentRequest.setAmount(new Amount().currency(currencyCode).value(amount));
        paymentRequest.setMerchantAccount(this.merchantAccount);
        paymentRequest.setReference(reference);
        paymentRequest.setShopperReference(shopperReference);
        paymentRequest.setShopperInteraction(PaymentRequest.ShopperInteractionEnum.CONTAUTH);
        paymentRequest.setRecurringProcessingModel(PaymentRequest.RecurringProcessingModelEnum.UNSCHEDULEDCARDONFILE);
        paymentRequest.setPaymentMethod(new CheckoutPaymentMethod(cardDetails));
        paymentRequest.setShopperEmail("john.doe@gmail.com");

        if ("embeddedPayment".equals(activityReason)) {
            paymentRequest.setStore(storeRef);
        } else if ("marketplace".equals(activityReason)) {
            List<Split> splits = new ArrayList<>();

            long commissionAmount = Math.round(amount * 0.10);
            long sellerAmount = amount - commissionAmount;

            Split sellerSplit = new Split();
            sellerSplit.setAmount(new SplitAmount().currency(currencyCode).value(sellerAmount));
            sellerSplit.setType(Split.TypeEnum.BALANCEACCOUNT);
            sellerSplit.setAccount(balanceAccountId);
            sellerSplit.setReference("SELLER_" + reference);

            Split platformSplit = new Split();
            platformSplit.setAmount(new SplitAmount().currency(currencyCode).value(commissionAmount));
            platformSplit.setType(Split.TypeEnum.COMMISSION);
            platformSplit.setReference("PLATFORM_FEE_" + reference);

            splits.add(sellerSplit);
            splits.add(platformSplit);

            paymentRequest.setSplits(splits);
        }

        PaymentResponse response = paymentsApi.payments(paymentRequest);

        TokenPaymentResponse tokenPaymentResponse = new TokenPaymentResponse();
        tokenPaymentResponse.setPspReference(response.getPspReference());
        tokenPaymentResponse.setResultCode(response.getResultCode() != null ? response.getResultCode().getValue() : null);
        tokenPaymentResponse.setRefusalReason(response.getRefusalReason());
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
