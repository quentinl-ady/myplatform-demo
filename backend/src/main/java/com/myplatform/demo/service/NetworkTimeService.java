package com.myplatform.demo.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.HttpURLConnection;
import java.net.URL;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

@Service
public class NetworkTimeService {

    private static final Logger log = LoggerFactory.getLogger(NetworkTimeService.class);

    public OffsetDateTime nowUtc() {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL("https://ca-test.adyen.com").openConnection();
            conn.setRequestMethod("HEAD");
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            conn.connect();

            String dateHeader = conn.getHeaderField("Date");
            conn.disconnect();

            if (dateHeader != null) {
                ZonedDateTime parsed = ZonedDateTime.parse(dateHeader, DateTimeFormatter.RFC_1123_DATE_TIME);
                return parsed.toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC);
            }
        } catch (Exception e) {
            log.warn("Failed to fetch network time, falling back to system clock: {}", e.getMessage());
        }
        return OffsetDateTime.now(ZoneOffset.UTC);
    }
}
