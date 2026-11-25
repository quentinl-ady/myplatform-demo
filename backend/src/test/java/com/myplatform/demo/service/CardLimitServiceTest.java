package com.myplatform.demo.service;

import com.myplatform.demo.dto.CardLimits;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestTemplate;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;
import static org.springframework.http.HttpStatus.FORBIDDEN;

class CardLimitServiceTest {

    private static final String LIMITS_URL = "https://balanceplatform-api-test.adyen.com/bcl/v2/paymentInstruments/PI1/limits";

    @Test
    void theUsageOfEachRuleIsAskedToAdyenRuleByRule() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer adyen = MockRestServiceServer.bindTo(restTemplate).build();
        CardLimitService service = new CardLimitService("key", restTemplate);
        adyen.expect(requestTo(LIMITS_URL + "?transactionRuleId=TR_TOTAL&requestType=authorization"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("X-API-Key", "key"))
                .andRespond(withSuccess("""
                        {"calculatedAt": "2025-03-19T10:15:30+01:00",
                         "amountLimits": [
                           {"limit": {"currency": "EUR", "value": 5000}, "spent": {"currency": "EUR", "value": 30000},
                            "remaining": {"currency": "EUR", "value": 0},
                            "source": {"type": "capability", "id": "withdrawal"}, "interval": {"type": "daily"}},
                           {"limit": {"currency": "EUR", "value": 50000}, "spent": {"currency": "EUR", "value": 12000},
                            "remaining": {"currency": "EUR", "value": 38000},
                            "source": {"type": "transactionRule", "id": "TR_TOTAL"}, "interval": {"type": "lifetime"}}]}
                        """, MediaType.APPLICATION_JSON));
        adyen.expect(requestTo(LIMITS_URL + "?transactionRuleId=TR_COUNT&requestType=authorization"))
                .andRespond(withSuccess("""
                        {"calculatedAt": "2025-03-19T10:15:31+01:00",
                         "countLimits": [{"limit": 3, "spent": 1, "remaining": 2,
                           "source": {"type": "transactionRule", "id": "TR_COUNT"}, "interval": {"type": "lifetime"}}]}
                        """, MediaType.APPLICATION_JSON));

        CardLimits limits = service.getLimits("PI1", List.of("TR_TOTAL", "TR_COUNT"));

        adyen.verify();
        assertThat(limits.calculatedAt()).isEqualTo("2025-03-19T10:15:30+01:00");
        assertThat(limits.limits()).containsExactly(
                new CardLimits.Usage("TR_TOTAL", "amount", 50000, 12000, 38000, "EUR", "lifetime"),
                new CardLimits.Usage("TR_COUNT", "count", 3, 1, 2, null, "lifetime"));
    }

    @Test
    void aRuleWhoseUsageAdyenRefusesIsLeftOut() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer adyen = MockRestServiceServer.bindTo(restTemplate).build();
        CardLimitService service = new CardLimitService("key", restTemplate);
        adyen.expect(requestTo(LIMITS_URL + "?transactionRuleId=TR_DENIED&requestType=authorization")).andRespond(withStatus(FORBIDDEN));
        adyen.expect(requestTo(LIMITS_URL + "?transactionRuleId=TR_NOT_TRACKED&requestType=authorization"))
                .andRespond(withSuccess("{\"calculatedAt\": \"2025-03-19T10:15:30+01:00\"}", MediaType.APPLICATION_JSON));

        CardLimits limits = service.getLimits("PI1", List.of("TR_DENIED", "TR_NOT_TRACKED"));

        adyen.verify();
        assertThat(limits.calculatedAt()).isEqualTo("2025-03-19T10:15:30+01:00");
        assertThat(limits.limits()).isEmpty();
    }

    @Test
    void aCardWithoutLimitRulesNeedsNoCall() {
        RestTemplate restTemplate = new RestTemplate();
        MockRestServiceServer adyen = MockRestServiceServer.bindTo(restTemplate).build();

        CardLimits limits = new CardLimitService("key", restTemplate).getLimits("PI1", List.of());

        adyen.verify();
        assertThat(limits.limits()).isEmpty();
        assertThat(limits.calculatedAt()).isNull();
    }
}
