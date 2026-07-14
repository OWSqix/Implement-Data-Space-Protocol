package org.eclipse.edc.molit.health;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/** Small process-level health probe that avoids adding OS packages to EDC images. */
public final class HttpHealthProbe {

    private HttpHealthProbe() {
    }

    public static void main(String[] args) {
        if (args.length != 1) {
            System.err.println("usage: HttpHealthProbe <http-url>");
            System.exit(2);
        }
        try {
            var uri = URI.create(args[0]);
            if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))) {
                throw new IllegalArgumentException("unsupported URI scheme");
            }
            var client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();
            var request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(2))
                    .GET()
                    .build();
            var response = client.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                System.err.println("health endpoint status=" + response.statusCode());
                System.exit(1);
            }
        } catch (Exception e) {
            System.err.println("health probe failed: " + e.getMessage());
            System.exit(1);
        }
    }
}
