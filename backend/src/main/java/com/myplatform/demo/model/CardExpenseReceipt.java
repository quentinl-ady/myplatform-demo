package com.myplatform.demo.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** The receipt of a card expense, in base64. Kept apart so that the expenses load without their files. */
@Entity
@Table(name = "card_expense_receipt")
@Getter
@Setter
public class CardExpenseReceipt {

    /** The id of its {@link CardExpense}. */
    @Id
    private Long expenseId;

    @Lob
    @Column(columnDefinition = "TEXT")
    private String data;
}
