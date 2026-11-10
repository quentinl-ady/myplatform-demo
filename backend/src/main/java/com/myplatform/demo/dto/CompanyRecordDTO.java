package com.myplatform.demo.dto;

import java.util.List;

/**
 * The company record of a business, as the sign-up page previews it before importing it.
 *
 * @param country            ISO code of the country of the company
 * @param legalForm          given to an organization, not to a sole proprietorship
 * @param address            postal lines of the registered office, the country last
 * @param registrationNumber number in the company register
 * @param vatNumber          null where the country has no VAT
 * @param phone              in E.164 format
 */
public record CompanyRecordDTO(String country,
                               String legalForm,
                               List<String> address,
                               String registrationNumber,
                               String vatNumber,
                               String phone) {
}
