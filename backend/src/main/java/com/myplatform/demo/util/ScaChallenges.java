package com.myplatform.demo.util;

import org.springframework.http.HttpHeaders;
import org.springframework.web.client.HttpClientErrorException;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reads the SCA challenge Adyen returns with a 401 when an operation needs strong customer authentication. */
public final class ScaChallenges {

    private static final Pattern AUTH_PARAM1 = Pattern.compile("auth-param1=\"([^\"]+)\"");

    private ScaChallenges() {
    }

    /** The challenge to pass to the SCA SDK, or null when the 401 carries none. */
    public static String authParam1(HttpClientErrorException exception) {
        HttpHeaders headers = exception.getResponseHeaders();
        String wwwAuthenticate = headers != null ? headers.getFirst("WWW-Authenticate") : null;
        if (wwwAuthenticate == null) {
            return null;
        }
        Matcher matcher = AUTH_PARAM1.matcher(wwwAuthenticate);
        return matcher.find() ? matcher.group(1) : null;
    }
}
