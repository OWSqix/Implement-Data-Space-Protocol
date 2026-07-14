/*
 * Adapted from Eclipse EDC Samples, transfer-03-consumer-pull.
 * SPDX-License-Identifier: Apache-2.0
 */
package org.eclipse.edc.molit.smoke;

import org.eclipse.edc.connector.dataplane.spi.Endpoint;
import org.eclipse.edc.connector.dataplane.spi.iam.DataPlaneAuthorizationService;
import org.eclipse.edc.connector.dataplane.spi.iam.PublicEndpointGeneratorService;
import org.eclipse.edc.runtime.metamodel.annotation.Configuration;
import org.eclipse.edc.runtime.metamodel.annotation.Inject;
import org.eclipse.edc.runtime.metamodel.annotation.Setting;
import org.eclipse.edc.runtime.metamodel.annotation.Settings;
import org.eclipse.edc.spi.EdcException;
import org.eclipse.edc.spi.system.ServiceExtension;
import org.eclipse.edc.spi.system.ServiceExtensionContext;
import org.eclipse.edc.web.spi.WebService;
import org.eclipse.edc.web.spi.configuration.PortMapping;
import org.eclipse.edc.web.spi.configuration.PortMappingRegistry;

/**
 * Minimal GET-only EDR endpoint used to prove an HTTP PULL flow in local/CI.
 * It is intentionally compiled into a separate artifact and must not be used
 * as an Internet-facing data-plane implementation.
 */
public class SmokePullProxyExtension implements ServiceExtension {

    private static final int DEFAULT_PUBLIC_PORT = 8084;
    private static final String DEFAULT_PUBLIC_PATH = "/public";

    @Configuration
    private PublicApiConfiguration apiConfiguration;

    @Setting(key = "edc.molit.smoke.enabled", description = "Explicit opt-in for the local/CI smoke extensions", defaultValue = "false")
    private boolean enabled;

    @Setting(description = "Base URL of the smoke public endpoint without a trailing slash",
            key = "edc.dataplane.proxy.public.endpoint")
    private String proxyPublicEndpoint;

    @Inject
    private PortMappingRegistry portMappingRegistry;
    @Inject
    private PublicEndpointGeneratorService generatorService;
    @Inject
    private WebService webService;
    @Inject
    private DataPlaneAuthorizationService authorizationService;

    @Override
    public void initialize(ServiceExtensionContext context) {
        if (!enabled) {
            throw new EdcException("Smoke-only EDC artifact requires edc.molit.smoke.enabled=true");
        }
        portMappingRegistry.register(new PortMapping("public", apiConfiguration.port(), apiConfiguration.path()));
        generatorService.addGeneratorFunction("HttpData", dataAddress -> Endpoint.url(proxyPublicEndpoint));
        webService.registerResource("public", new SmokeProxyController(authorizationService));
    }

    @Settings
    record PublicApiConfiguration(
            @Setting(key = "web.http.public.port", description = "Port for the smoke public API", defaultValue = DEFAULT_PUBLIC_PORT + "")
            int port,
            @Setting(key = "web.http.public.path", description = "Path for the smoke public API", defaultValue = DEFAULT_PUBLIC_PATH)
            String path) {
    }
}
