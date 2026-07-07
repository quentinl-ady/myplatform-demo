package com.myplatform.demo.configuration;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class BufferingClientHttpResponseWrapper implements ClientHttpResponse {

    private final ClientHttpResponse delegate;
    private final byte[] body;

    public BufferingClientHttpResponseWrapper(ClientHttpResponse delegate, String body) {
        this.delegate = delegate;
        this.body = body != null ? body.getBytes(StandardCharsets.UTF_8) : new byte[0];
    }

    @Override
    public HttpStatusCode getStatusCode() throws IOException {
        return delegate.getStatusCode();
    }

    @Override
    public String getStatusText() throws IOException {
        return delegate.getStatusText();
    }

    @Override
    public void close() {
        delegate.close();
    }

    @Override
    public InputStream getBody() throws IOException {
        return new ByteArrayInputStream(body);
    }

    @Override
    public HttpHeaders getHeaders() {
        return delegate.getHeaders();
    }
}
