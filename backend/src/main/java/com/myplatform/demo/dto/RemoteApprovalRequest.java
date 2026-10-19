package com.myplatform.demo.dto;

import com.myplatform.demo.model.TransferRequest;

import java.util.List;
import java.util.Map;

/**
 * An operation to approve on the phone. Only the field of its type is read: transfer,
 * standingOrder or transferIds; the transactions need none.
 *
 * @param type transfer, standingOrder, batch or transactions
 */
public record RemoteApprovalRequest(String userId,
                                    String type,
                                    TransferRequest transfer,
                                    Map<String, Object> standingOrder,
                                    List<String> transferIds) {
}
