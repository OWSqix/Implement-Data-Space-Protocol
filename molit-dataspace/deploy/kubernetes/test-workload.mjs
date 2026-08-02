import { createServer } from "node:http";

const port = Number(process.env.WEB_HTTP_PORT ?? "8080");
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"status":"ready"}');
});
server.listen(port, "0.0.0.0");
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
