package com.myplatform.demo.util;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

public class DocumentUtil {
    private static String BASE64_EMPTY_PDF = "JVBERi0xLjQKJeLjz9MKCjEgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvUmVzb3VyY2VzIDw8IC9Qcm9jU2V0IFsgL1BERiBdID4+IC9NZWRpYUJveCBbIDAgMCAxIDFdID4+CmVuZG9iagoKMiAwIG9iago8PCAvVHlwZSAvUGFnZXMgL0tpZHMgWyAxIDAgUiBdID4+CmVuZG9iagoKMyAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCgp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDAyMCAwMDAwMCBuIAowMDAwMDAwMDMwIDAwMDAwIG4gCnRyYWlsZX";


    public static String generateBase64EmptyPdf() {
        String randomToken = UUID.randomUUID().toString();
        String encodedToken = Base64.getEncoder().encodeToString(randomToken.getBytes());
        return BASE64_EMPTY_PDF + encodedToken;
    }

    public static String loadResource(String resourceName) throws IOException {
        try (InputStream is = DocumentUtil.class.getClassLoader().getResourceAsStream(resourceName)) {
            if (is == null) {
                throw new IOException("Resource not found: " + resourceName);
            }
            String base64Content = new String(is.readAllBytes(), StandardCharsets.UTF_8).trim();
            byte[] imageBytes = java.util.Base64.getDecoder().decode(base64Content);
            byte[] uuidBytes = java.util.UUID.randomUUID().toString().getBytes(StandardCharsets.UTF_8);
            byte[] uniqueImage = new byte[imageBytes.length + uuidBytes.length];
            System.arraycopy(imageBytes, 0, uniqueImage, 0, imageBytes.length);
            System.arraycopy(uuidBytes, 0, uniqueImage, imageBytes.length, uuidBytes.length);
            return java.util.Base64.getEncoder().encodeToString(uniqueImage);
        }
    }

}
