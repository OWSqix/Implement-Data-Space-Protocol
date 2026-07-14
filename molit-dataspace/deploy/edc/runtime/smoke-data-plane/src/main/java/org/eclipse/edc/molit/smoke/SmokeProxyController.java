/*
 * Adapted from Eclipse EDC Samples, transfer-03-consumer-pull.
 * SPDX-License-Identifier: Apache-2.0
 */
package org.eclipse.edc.molit.smoke;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.Response;
import org.eclipse.edc.connector.dataplane.spi.iam.DataPlaneAuthorizationService;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static jakarta.ws.rs.core.HttpHeaders.AUTHORIZATION;
import static jakarta.ws.rs.core.HttpHeaders.CONTENT_TYPE;
import static jakarta.ws.rs.core.MediaType.APPLICATION_OCTET_STREAM;
import static jakarta.ws.rs.core.MediaType.WILDCARD;
import static jakarta.ws.rs.core.Response.Status.FORBIDDEN;
import static jakarta.ws.rs.core.Response.Status.UNAUTHORIZED;
import static java.util.Collections.emptyMap;
import static org.eclipse.edc.spi.constants.CoreConstants.EDC_NAMESPACE;

/**
 * Smoke-only authenticated probe for one immutable fixture.
 *
 * <p>This is deliberately not a general HTTP proxy. The authorized source
 * address must name the Compose-only fixture origin, and the outbound request
 * always targets the compile-time constant {@code /data.json}. Incoming path,
 * query, and headers are never used to construct the upstream request.</p>
 */
@Path("data.json")
@Produces(WILDCARD)
public class SmokeProxyController {

    private static final URI ALLOWED_BACKEND_ORIGIN = URI.create("http://provider-backend:8080");
    private static final URI FIXTURE_RESOURCE = URI.create("http://provider-backend:8080/data.json");

    private final DataPlaneAuthorizationService authorizationService;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public SmokeProxyController(DataPlaneAuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @GET
    public Response proxyGet(@Context ContainerRequestContext requestContext) {
        var token = requestContext.getHeaderString(AUTHORIZATION);
        if (token == null) {
            return Response.status(UNAUTHORIZED).build();
        }
        var authorization = authorizationService.authorize(token, emptyMap());
        if (authorization.failed()) {
            return Response.status(FORBIDDEN).build();
        }

        try {
            var sourceDataAddress = authorization.getContent();
            var authorizedBaseUrl = sourceDataAddress.getStringProperty(EDC_NAMESPACE + "baseUrl");
            if (!isAllowedBackendOrigin(authorizedBaseUrl)) {
                return Response.status(FORBIDDEN).build();
            }
            var request = HttpRequest.newBuilder()
                    .uri(FIXTURE_RESOURCE)
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            return Response.status(response.statusCode())
                    .header(CONTENT_TYPE, response.headers().firstValue(CONTENT_TYPE).orElse(APPLICATION_OCTET_STREAM))
                    .entity(response.body())
                    .build();
        } catch (IOException e) {
            return Response.status(Response.Status.BAD_GATEWAY).entity("upstream unavailable").build();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Response.status(Response.Status.SERVICE_UNAVAILABLE).entity("request interrupted").build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_GATEWAY).entity("invalid upstream address").build();
        }
    }

    private static boolean isAllowedBackendOrigin(String value) {
        if (value == null) {
            return false;
        }
        var candidate = URI.create(value);
        var path = candidate.getRawPath();
        return ALLOWED_BACKEND_ORIGIN.getScheme().equals(candidate.getScheme())
                && ALLOWED_BACKEND_ORIGIN.getHost().equals(candidate.getHost())
                && ALLOWED_BACKEND_ORIGIN.getPort() == candidate.getPort()
                && candidate.getRawUserInfo() == null
                && (path == null || path.isEmpty() || "/".equals(path))
                && candidate.getRawQuery() == null
                && candidate.getRawFragment() == null;
    }
}
