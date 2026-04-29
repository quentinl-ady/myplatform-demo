package com.myplatform.demo.service;


import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.NumericDate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;


@Service
public class GpayJwtService {

    public static final String MERCHANT_ID = "BCR2DN5TRCO6VRS6";

    @Value("${adyen.gpay.privateKey:}")
    private String gpayPrivateKey;

    public String generateAuthJwt(String hostname) {
        try {
            PrivateKey privateKey = loadPrivateKey();

            // Claims (payload)
            JwtClaims claims = new JwtClaims();
            claims.setIssuedAt(NumericDate.fromSeconds(Instant.now().getEpochSecond()));
            claims.setStringClaim("merchantId", MERCHANT_ID);
            claims.setStringClaim("merchantOrigin", hostname);

            // JWS
            JsonWebSignature jws = new JsonWebSignature();
            jws.setPayload(claims.toJson());
            jws.setKey(privateKey);
            jws.setAlgorithmHeaderValue(
                    AlgorithmIdentifiers.ECDSA_USING_P256_CURVE_AND_SHA256
            );
            jws.setHeader("typ", "JWT");

            return jws.getCompactSerialization();

        } catch (Exception e) {
            throw new RuntimeException("Failed to generate Google Pay authJwt", e);
        }
    }

    private PrivateKey loadPrivateKey() throws Exception {
        String pem;

        if (gpayPrivateKey != null && !gpayPrivateKey.isBlank()) {
            pem = gpayPrivateKey;
        } else {
            try (InputStream is =
                         GpayJwtService.class
                                 .getClassLoader()
                                 .getResourceAsStream("gpay-key.pem")) {

                if (is == null) {
                    throw new IllegalStateException("Google Pay private key not found: set adyen.gpay.privateKey or provide gpay-key.pem");
                }
                pem = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            }
        }

        String privateKeyPem = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replaceAll("\\s+", "");

        byte[] keyBytes = Base64.getDecoder().decode(privateKeyPem);

        PKCS8EncodedKeySpec keySpec = new PKCS8EncodedKeySpec(keyBytes);
        KeyFactory keyFactory = KeyFactory.getInstance("EC");

        return keyFactory.generatePrivate(keySpec);
    }
}
