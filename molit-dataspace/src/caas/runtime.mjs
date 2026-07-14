import { loadCaasConfig } from "./config.mjs";
import { createCaasProvisioners } from "./provisioner.mjs";
import { CaaSControlService } from "./service.mjs";
import { CaaSAuthorizer } from "./auth.mjs";
import { createCaaSHttpServer } from "./server.mjs";

export async function createCaaSRuntime({ configPath, env = process.env }) {
  const config = await loadCaasConfig(configPath);
  const provisioners = createCaasProvisioners(config);
  const service = new CaaSControlService({ config, provisioners, env });
  const authorizer = new CaaSAuthorizer({ config, env });
  const server = createCaaSHttpServer({ config, service, authorizer });
  return { config, provisioners, service, authorizer, server };
}
