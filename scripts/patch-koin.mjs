import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("node_modules/koin.js/dist");
const files = ["index.mjs", "index.js"];
const telemetryReplacement = `// Fetchcade deliberately disables Koin's optional telemetry.\nvar sendTelemetry = () => {};`;
const telemetryPattern = /\/\/ src\/lib\/telemetry\.ts\nvar sendTelemetry = \(eventName, params = \{\}\) => \{[\s\S]*?\n\};\n\n\/\/ src\/locales\/es\.ts/;

function replaceOnce(source, oldText, newText, file, label) {
  const occurrences = source.split(oldText).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected one ${label} marker in ${file}; found ${occurrences}`);
  }
  return source.replace(oldText, newText);
}

for (const file of files) {
  const target = path.join(packageRoot, file);
  if (!fs.existsSync(target)) {
    throw new Error(`Expected Koin bundle not found: ${target}`);
  }

  let source = fs.readFileSync(target, "utf8");
  if (!source.includes("Fetchcade deliberately disables Koin's optional telemetry")) {
    if (!telemetryPattern.test(source)) {
      throw new Error(`Koin telemetry block changed; refusing an unreviewed patch in ${file}`);
    }
    source = source.replace(telemetryPattern, `${telemetryReplacement}\n\n// src/locales/es.ts`);
    console.log(`Patched Koin telemetry in ${file}`);
  }

  if (!source.includes("Fetchcade aborts unfinished Koin preparation on unmount.")) {
    const hookPrefix = file === "index.js" ? "React2." : "";
    source = replaceOnce(
      source,
      `  const isStartingRef = ${hookPrefix}useRef(false);\n  const prepare = ${hookPrefix}useCallback`,
      `  const isStartingRef = ${hookPrefix}useRef(false);\n  // Fetchcade aborts unfinished Koin preparation on unmount.\n  const prepareAbortRef = ${hookPrefix}useRef(null);\n  const prepare = ${hookPrefix}useCallback`,
      file,
      "Koin preparation ref",
    );
    source = replaceOnce(
      source,
      `  const prepare = ${hookPrefix}useCallback(async () => {\n    if (!romUrl || !system) {`,
      `  const prepare = ${hookPrefix}useCallback(async () => {\n    const controller = new AbortController();\n    prepareAbortRef.current = controller;\n    if (!romUrl || !system) {`,
      file,
      "Koin preparation controller",
    );
    source = replaceOnce(
      source,
      "      const prepareOptions = {\n        core: coreOption,",
      "      const prepareOptions = {\n        signal: controller.signal,\n        core: coreOption,",
      file,
      "Koin preparation signal",
    );
    const nostalgistName = file === "index.js" ? "nostalgist$1" : "nostalgist";
    const prepareCall = file === "index.js" ? "nostalgist.Nostalgist.prepare" : "Nostalgist.prepare";
    source = replaceOnce(
      source,
      `      const ${nostalgistName} = await ${prepareCall}(prepareOptions);\n      nostalgistRef.current = ${nostalgistName};\n      setStatus(\"ready\");`,
      `      const ${nostalgistName} = await ${prepareCall}(prepareOptions);\n      if (controller.signal.aborted) {\n        ${nostalgistName}.exit?.({ removeCanvas: false });\n        return;\n      }\n      if (prepareAbortRef.current === controller) prepareAbortRef.current = null;\n      nostalgistRef.current = ${nostalgistName};\n      setStatus(\"ready\");`,
      file,
      "Koin preparation completion",
    );
    source = replaceOnce(
      source,
      "    } catch (err) {\n      const errorMessage = err instanceof Error ? err.message : \"Failed to prepare emulator\";",
      "    } catch (err) {\n      if (controller.signal.aborted) return;\n      const errorMessage = err instanceof Error ? err.message : \"Failed to prepare emulator\";",
      file,
      "Koin preparation abort guard",
    );
    source = replaceOnce(
      source,
      `  const stop = ${hookPrefix}useCallback(() => {\n    if (nostalgistRef.current) {`,
      `  const stop = ${hookPrefix}useCallback(() => {\n    prepareAbortRef.current?.abort();\n    prepareAbortRef.current = null;\n    if (nostalgistRef.current) {`,
      file,
      "Koin stop abort",
    );
    console.log(`Patched Koin preparation cleanup in ${file}`);
  }

  fs.writeFileSync(target, source);
}
