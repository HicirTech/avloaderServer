/** Wires the pieces together and starts listening. */

import { loadConfig } from "./config";
import { createJavdbClient } from "./javdb/client";
import { createLookup } from "./javdb/lookup";
import { createHandler } from "./server";
import { createThrottle } from "./throttle";

const config = loadConfig();
const throttle = createThrottle(config.minIntervalMs);
const handler = createHandler(config, createLookup(createJavdbClient(config, throttle)));

const server = Bun.serve({
  port: config.port,
  fetch: (request) => handler.fetch(request),
});

console.log(
  `listening on http://localhost:${config.port} ` +
    `(impersonate ${config.impersonate}, min interval ${config.minIntervalMs} ms, ` +
    `max ${config.maxInFlight} in flight)`,
);

// Stop accepting, then let the process end once the in-flight lookups and their
// curl children have finished, rather than orphaning them on `compose down`.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, draining ${handler.inFlight()} lookups`);
    server.stop();
  });
}
