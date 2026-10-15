package com.myplatform.demo.util;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.ser.std.StdSerializer;

import java.io.IOException;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

/**
 * Writes a LocalDateTime stored in UTC (LocalDateTime.now(ZoneOffset.UTC)) as an ISO instant
 * such as "2026-10-15T08:00:00.123Z", so browsers don't have to guess the server zone.
 * The column has no zone, and the hosted and local backends share one database while
 * running in different zones, so UTC is the only safe convention. Milliseconds only:
 * some browsers reject longer fractions.
 */
public class UtcDateTimeSerializer extends StdSerializer<LocalDateTime> {

    public UtcDateTimeSerializer() {
        super(LocalDateTime.class);
    }

    @Override
    public void serialize(LocalDateTime value, JsonGenerator gen, SerializerProvider provider) throws IOException {
        gen.writeString(value.toInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.MILLIS).toString());
    }
}
