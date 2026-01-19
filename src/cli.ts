#!/usr/bin/env bun
import { printHelp } from "./cli/help";
import { cmdUpdate, cmdVersion, maybeCheckForUpdate } from "./cli/self-update";

const argv = process.argv.slice(2);

const command = argv[0];

if (!command || command === "--help" || command === "-h" || command === "help") {
  const advanced = argv.includes("all");
  printHelp(advanced);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  cmdVersion();
  process.exit(0);
}

if (command === "mcp") {
  const { runMcpServer } = await import("./mcp");
  await runMcpServer();
} else if (command === "reset") {
  const { cmdReset } = await import("./cli/reset");
  await cmdReset(argv.slice(1));
} else if (command === "version") {
  cmdVersion();
} else if (command === "update") {
  await cmdUpdate();
} else {
  await maybeCheckForUpdate(command, argv.slice(1));
  const { createStore } = await import("./store/db");
  const store = await createStore();
  try {
    switch (command) {
      case "init": {
        const { cmdInit } = await import("./cli/setup");
        cmdInit();
        break;
      }
      case "setup": {
        const { cmdSetup } = await import("./cli/setup");
        await cmdSetup(argv.slice(1), store);
        break;
      }
      case "onboard": {
        const { cmdOnboard } = await import("./cli/setup");
        await cmdOnboard(argv.slice(1), store);
        break;
      }
      case "source": {
        const { cmdSource } = await import("./cli/source");
        await cmdSource(store, argv.slice(1));
        break;
      }
      case "add": {
        const { cmdAdd } = await import("./cli/source");
        await cmdAdd(store, argv.slice(1));
        break;
      }
      case "ingest": {
        const { cmdIngest } = await import("./cli/ingest");
        await cmdIngest(store, argv.slice(1));
        break;
      }
      case "detect": {
        const { cmdDetect } = await import("./cli/detect");
        await cmdDetect(argv.slice(1));
        break;
      }
      case "embed": {
        const { cmdEmbed } = await import("./cli/embed");
        await cmdEmbed(store, argv.slice(1));
        break;
      }
      case "search": {
        const { cmdSearch } = await import("./cli/search");
        await cmdSearch(store, argv.slice(1));
        break;
      }
      case "library": {
        const { cmdLibrary } = await import("./cli/library");
        await cmdLibrary(store, argv.slice(1));
        break;
      }
      case "vsearch": {
        const { cmdVSearch } = await import("./cli/search");
        await cmdVSearch(store, argv.slice(1));
        break;
      }
      case "query": {
        const { cmdQuery } = await import("./cli/search");
        await cmdQuery(store, argv.slice(1));
        break;
      }
      case "get": {
        const { cmdGet } = await import("./cli/get");
        await cmdGet(store, argv.slice(1));
        break;
      }
      case "db": {
        const { cmdDb } = await import("./cli/db");
        await cmdDb(store, argv.slice(1));
        break;
      }
      case "status": {
        const { cmdStatus } = await import("./cli/status");
        await cmdStatus(store);
        break;
      }
      case "cleanup": {
        const { cmdCleanup } = await import("./cli/status");
        await cmdCleanup(store);
        break;
      }
      case "seed": {
        const { cmdSeed } = await import("./cli/seed");
        await cmdSeed(store, argv.slice(1));
        break;
      }
      default:
        printHelp(false);
        process.exit(1);
    }
  } finally {
    store.close();
  }
}
