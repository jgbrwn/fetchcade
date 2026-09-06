import fs from "node:fs";

const workerName = process.env.FETCHCADE_WORKER_NAME?.trim();
const customDomain = process.env.FETCHCADE_CUSTOM_DOMAIN?.trim();

if (!workerName) {
  throw new Error("Set FETCHCADE_WORKER_NAME before generating the Wrangler config.");
}

const config = {
  "$schema": "./node_modules/wrangler/config-schema.json",
  name: workerName,
  main: "worker/index.js",
  compatibility_date: "2026-09-06",
  workers_dev: true,
  assets: {
    directory: "./dist",
    binding: "ASSETS",
    run_worker_first: ["/fetch", "/health"],
    not_found_handling: "single-page-application",
  },
};

if (customDomain) {
  config.routes = [{ pattern: customDomain, custom_domain: true }];
}

fs.writeFileSync(".wrangler.generated.json", `${JSON.stringify(config, null, 2)}\n`);
console.log(`Generated Wrangler config for Worker ${workerName}${customDomain ? ` and custom domain ${customDomain}` : ""}.`);
