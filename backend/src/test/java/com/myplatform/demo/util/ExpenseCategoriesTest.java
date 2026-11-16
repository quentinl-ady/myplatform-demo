package com.myplatform.demo.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ExpenseCategoriesTest {

    @Test
    void theMerchantCategoryCodeOfACardPaymentSuggestsACategory() {
        assertThat(ExpenseCategories.forMcc("5812")).isEqualTo(ExpenseCategories.MEALS);
        assertThat(ExpenseCategories.forMcc("3001")).isEqualTo(ExpenseCategories.TRAVEL); // an airline
        assertThat(ExpenseCategories.forMcc(" 7372 ")).isEqualTo(ExpenseCategories.SOFTWARE);
        assertThat(ExpenseCategories.forMcc("5999")).isEqualTo(ExpenseCategories.OTHER);
        assertThat(ExpenseCategories.forMcc(null)).isEqualTo(ExpenseCategories.OTHER);
        assertThat(ExpenseCategories.forMcc("abc")).isEqualTo(ExpenseCategories.OTHER);
    }

    @Test
    void anUnknownAccountIsOtherExpenses() {
        assertThat(ExpenseCategories.of("6230")).isEqualTo(ExpenseCategories.TRAVEL);
        assertThat(ExpenseCategories.of("9999")).isEqualTo(ExpenseCategories.OTHER);
        assertThat(ExpenseCategories.find("9999")).isEmpty();
    }
}
