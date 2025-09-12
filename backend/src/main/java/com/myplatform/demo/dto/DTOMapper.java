package com.myplatform.demo.dto;

import com.myplatform.demo.model.StoreCustomer;
import com.myplatform.demo.model.User;

import java.util.List;

public class DTOMapper {

    public static StoreCustomerDTO toStoreCustomerDTO(StoreCustomer storeCustomer) {
        StoreCustomerDTO dto = new StoreCustomerDTO();
        dto.setStoreId(storeCustomer.getStoreId());
        dto.setStoreRef(storeCustomer.getStoreRef());
        dto.setCity(storeCustomer.getCity());
        dto.setCountry(storeCustomer.getCountry());
        dto.setLineAdresse(storeCustomer.getLineAdresse());
        dto.setPhoneNumber(storeCustomer.getPhoneNumber());

        if (storeCustomer.getBalanceAccountInfoCustomer() != null) {
            BalanceAccountInfoCustomerDTO balanceDTO = new BalanceAccountInfoCustomerDTO();
            balanceDTO.setBalanceAccountId(storeCustomer.getBalanceAccountInfoCustomer().getBalanceAccountId());
            balanceDTO.setCurrencyCode(storeCustomer.getBalanceAccountInfoCustomer().getCurrencyCode());
            balanceDTO.setDescription(storeCustomer.getBalanceAccountInfoCustomer().getDescription());
            dto.setBalanceAccountInfoCustomer(balanceDTO);
        }

        if (storeCustomer.getPaymentMethodCustomers() != null) {
            List<PaymentMethodCustomerDTO> paymentDTOs = storeCustomer.getPaymentMethodCustomers()
                    .stream()
                    .map(pm -> {
                        PaymentMethodCustomerDTO pmDTO = new PaymentMethodCustomerDTO();
                        pmDTO.setType(pm.getType());
                        pmDTO.setVerificationStatus(pm.getVerificationStatus());
                        return pmDTO;
                    })
                    .toList();
            dto.setPaymentMethods(paymentDTOs);
        }

        return dto;
    }

    public static UserDTO toUserDTO(User user) {
        UserDTO dto = new UserDTO();
        dto.setId(user.getId());
        dto.setEmail(user.getEmail());
        dto.setFirstName(user.getFirstName());
        dto.setLastName(user.getLastName());
        dto.setLegalEntityName(user.getLegalEntityName());
        dto.setLegalEntityId(user.getLegalEntityId());
        dto.setAccountHolderId(user.getAccountHolderId());
        dto.setBalanceAccountId(user.getBalanceAccountId());
        dto.setCurrencyCode(user.getCurrencyCode());
        dto.setCountryCode(user.getCountryCode());
        dto.setUserType(user.getUserType());
        return dto;
    }
}

