import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KubernetesApiClient } from "../../src/caas/kubernetes-provisioner.mjs";

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("Kubernetes API client rereads the projected token without placing it in configuration", async (t) => {
  const authorizations = [];
  const server = await listen((request, response) => {
    authorizations.push(request.headers.authorization);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ apiVersion: "v1", kind: "Namespace", metadata: { name: "molit-caas-system" } }));
  });
  t.after(() => server.close());
  const directory = await mkdtemp(join(tmpdir(), "molit-kube-client-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "projected-token-value-one");
  const client = new KubernetesApiClient({ apiServer: `http://127.0.0.1:${server.address().port}/`, tokenFile, caFile: join(directory, "unused-ca"), requestTimeoutMs: 1000 });
  assert.equal((await client.get("/api/v1/namespaces/molit-caas-system")).metadata.name, "molit-caas-system");
  await writeFile(tokenFile, "projected-token-value-two");
  await client.get("/api/v1/namespaces/molit-caas-system");
  assert.deepEqual(authorizations, ["Bearer projected-token-value-one", "Bearer projected-token-value-two"]);
  assert.doesNotMatch(JSON.stringify(client), /projected-token-value/u);
});

test("Kubernetes API client destroys an in-flight request when its deadline signal aborts", async (t) => {
  let requestClosed = false;
  let handlerEntered;
  const entered = new Promise((resolve) => { handlerEntered = resolve; });
  const server = await listen((request) => {
    handlerEntered();
    request.on("close", () => { requestClosed = true; });
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const directory = await mkdtemp(join(tmpdir(), "molit-kube-client-abort-"));
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, "projected-token-value-abort");
  const client = new KubernetesApiClient({ apiServer: `http://127.0.0.1:${server.address().port}/`, tokenFile, caFile: join(directory, "unused-ca"), requestTimeoutMs: 10_000 });
  const controller = new AbortController();
  const reason = new Error("request deadline expired");
  const pending = client.get("/api/v1/namespaces", { signal: controller.signal });
  await entered;
  controller.abort(reason);
  await assert.rejects(pending, /request deadline expired/u);
  for (let attempt = 0; attempt < 20 && !requestClosed; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(requestClosed, true);
});
