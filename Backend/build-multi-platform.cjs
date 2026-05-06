#!/usr/bin/env node
// Cross-platform VOOTED EXE builder.
//
// Why this works without WSL2 / Docker on a Windows host: VOOTED has zero
// native-module dependencies (no .node binaries — fastify family + sequelize
// + pure-JS pg + node-cron + iso-639-1). pkg-fetch downloads the prebuilt
// Node binary for each target platform and combines it with our shared JS
// bundle. The resulting Linux ELF / Windows PE files are produced regardless
// of which OS runs this script.
//
// Caveat: build success != runtime success. Each output should be smoke-tested
// on its target OS before release. See ../CROSS_PLATFORM_BUILD.md.

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const TARGETS = {
  win64: { pkgTarget: "node20-win-x64", extension: ".exe", arch: "x64" },
  "linux-x64": { pkgTarget: "node20-linux-x64", extension: "", arch: "x64" },
  "linux-arm64": { pkgTarget: "node20-linux-arm64", extension: "", arch: "arm64" },
};

// pkg's "fabricator" step pre-compiles JS to V8 bytecode by spawning a Node
// binary of the *target* CPU arch. When host arch != target arch (e.g.
// building linux-arm64 from a Windows-x64 host) that spawn fails with
// `spawn UNKNOWN`. Workaround per pkg docs: skip bytecode compilation. The
// binary still runs fine — just loads source instead of pre-compiled bytecode,
// adding a small startup cost that's invisible in practice.
function isCrossArch(targetKey) {
  return TARGETS[targetKey].arch !== process.arch;
}

function parseArgs(argv) {
  const targets = [];
  let all = false;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--target") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--target needs a value (one of: " + Object.keys(TARGETS).join(", ") + ")");
      }
      if (!TARGETS[next]) {
        throw new Error(
          `Unknown target: ${next}. Known: ${Object.keys(TARGETS).join(", ")}`,
        );
      }
      if (!targets.includes(next)) targets.push(next);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (all) return Object.keys(TARGETS);
  if (targets.length === 0) {
    throw new Error(
      "No targets specified. Use --all or one or more --target <name> flags.",
    );
  }
  return targets;
}

function printUsage() {
  console.log("Usage: node build-multi-platform.cjs [--all] [--target <name> ...]");
  console.log("");
  console.log("Targets:");
  for (const [key, { pkgTarget }] of Object.entries(TARGETS)) {
    console.log(`  ${key.padEnd(14)}${pkgTarget}`);
  }
}

function bundleServer() {
  const buildScript = path.join(__dirname, "build.cjs");
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: __dirname,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("esbuild bundle step failed (see output above).");
  }
}

function packageForTarget(targetKey, version) {
  const { pkgTarget, extension } = TARGETS[targetKey];
  const releaseDir = path.resolve(__dirname, "..", "Release");
  fs.mkdirSync(releaseDir, { recursive: true });

  const outputName = `VOOTED-${targetKey}-${version}${extension}`;
  const outputPath = path.join(releaseDir, outputName);

  const pkgBin = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
  const bundlePath = path.join(__dirname, "dist-server", "bundle.cjs");
  const configPath = path.join(__dirname, "package.json");

  const args = [
    pkgBin,
    bundlePath,
    "-c",
    configPath,
    "--targets",
    pkgTarget,
    "--output",
    outputPath,
  ];

  if (isCrossArch(targetKey)) {
    args.push("--no-bytecode", "--public");
    console.log(
      `[VOOTED build] Cross-arch (${process.arch} → ${TARGETS[targetKey].arch}) — disabling bytecode compilation.`,
    );
  }

  const result = spawnSync(process.execPath, args, {
    cwd: __dirname,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`pkg failed for target ${targetKey} (exit ${result.status}).`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`pkg reported success but ${outputPath} is missing.`);
  }

  return outputPath;
}

function main() {
  const targets = parseArgs(process.argv);
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"),
  );
  const version = pkgJson.version || "0.0.0";

  console.log(
    `[VOOTED build] version=${version} targets=${targets.join(",")}`,
  );

  console.log(`\n[VOOTED build] Bundling server with esbuild (shared step)...`);
  bundleServer();

  const results = [];
  for (const target of targets) {
    console.log(`\n[VOOTED build] Packaging ${target} (${TARGETS[target].pkgTarget})...`);
    try {
      const outputPath = packageForTarget(target, version);
      const stat = fs.statSync(outputPath);
      results.push({
        target,
        status: "ok",
        outputPath,
        sizeBytes: stat.size,
      });
    } catch (err) {
      results.push({
        target,
        status: "fail",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`\n[VOOTED build] Summary`);
  console.log(`──────────────────────────────────────────────────`);
  for (const r of results) {
    if (r.status === "ok") {
      const mb = (r.sizeBytes / 1024 / 1024).toFixed(1);
      const rel = path.relative(process.cwd(), r.outputPath);
      console.log(`  OK    ${r.target.padEnd(14)} ${rel}  (${mb} MB)`);
    } else {
      console.log(`  FAIL  ${r.target.padEnd(14)} ${r.error}`);
    }
  }

  const failed = results.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    console.error(
      `\n[VOOTED build] ${failed.length}/${results.length} target(s) failed.`,
    );
    process.exit(1);
  }
  console.log(
    `\n[VOOTED build] All ${results.length} target(s) built successfully.`,
  );
  console.log(
    `[VOOTED build] Reminder: build success != runtime success. Smoke-test each binary on its target OS before release.`,
  );
}

try {
  main();
} catch (err) {
  console.error(`[VOOTED build] Fatal: ${err instanceof Error ? err.message : err}`);
  printUsage();
  process.exit(1);
}
