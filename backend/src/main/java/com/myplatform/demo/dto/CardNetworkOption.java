package com.myplatform.demo.dto;

import java.util.List;

/**
 * A card network the platform can issue cards on.
 *
 * @param brand      visa or mc
 * @param currencies balance account currencies it can issue cards in; null when not restricted to some currencies
 */
public record CardNetworkOption(String brand, List<String> currencies) {
}
