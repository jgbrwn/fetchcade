import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("node_modules/koin.js/dist");
const files = ["index.mjs", "index.js"];
const replacement = `// Fetchcade deliberately disables Koin's optional telemetry.\nvar sendTelemetry = () => {};`;
const pattern = /\/\/ src\/lib\/telemetry\.ts\nvar sendTelemetry = \(eventName, params = \{\}\) => \{[\s\S]*?\n\};\n\n\/\/ src\/locales\/es\.ts/;

for (const file of files) {
  const target = path.join(packageRoot, file);
  if (!fs.existsSync(target)) {
    throw new Error(`Expected Koin bundle not found: ${target}`);
  }

  const source = fs.readFileSync(target, "utf8");
  if (source.includes("Fetchcade deliberately disables Koin's optional telemetry")) continue;
  if (!pattern.test(source)) {
    throw new Error(`Koin telemetry block changed; refusing an unreviewed patch in ${file}`);
  }

  const patched = source.replace(pattern, `${replacement}\n\n// src/locales/es.ts`);
  fs.writeFileSync(target, patched);
  console.log(`Patched Koin telemetry in ${file}`);
}
