#!/usr/bin/env bun
import { createStore } from "./store/db";
import { printHelp } from "./cli/help";
import { cmdInit, cmdSetup, cmdOnboard } from "./cli/setup";
import { cmdStatus, cmdCleanup } from "./cli/status";
import { cmdGet } from "./cli/get";
import { cmdSearch, cmdVSearch, cmdQuery } from "./cli/search";
import { cmdEmbed } from "./cli/embed";
import { cmdDetect } from "./cli/detect";
import { cmdSource, cmdAdd } from "./cli/source";
import { cmdIngest } from "./cli/ingest";
import { cmdLibrary } from "./cli/library";
import { cmdDb } from "./cli/db";
import { cmdReset } from "./cli/reset";
import { cmdSeed } from "./cli/seed";
import { runMcpServer } from "./mcp";

const argv = process.argv.slice(2);

const command = argv[0];

if (!command || command === "--help" || command === "-h" || command === "help") {
  const advanced = argv.includes("all");
  printHelp(advanced);
  process.exit(0);
}

if (command === "mcp") {
  await runMcpServer();
} else if (command === "reset") {
  await cmdReset(argv.slice(1));
} else {
  const store = await createStore();
  try {
    switch (command) {
      case "init":
        cmdInit();
        break;
      case "setup":
        await cmdSetup(argv.slice(1), store);
        break;
      case "onboard":
        await cmdOnboard(argv.slice(1), store);
        break;
      case "source":
        await cmdSource(store, argv.slice(1));
        break;
      case "add":
        await cmdAdd(store, argv.slice(1));
        break;
      case "ingest":
        await cmdIngest(store, argv.slice(1));
        break;
      case "update":
        await cmdIngest(store, argv.slice(1));
        break;
      case "detect":
        await cmdDetect(argv.slice(1));
        break;
      case "embed":
        await cmdEmbed(store, argv.slice(1));
        break;
      case "search":
        await cmdSearch(store, argv.slice(1));
        break;
      case "library":
        await cmdLibrary(store, argv.slice(1));
        break;
      case "vsearch":
        await cmdVSearch(store, argv.slice(1));
        break;
      case "query":
        await cmdQuery(store, argv.slice(1));
        break;
      case "get":
        await cmdGet(store, argv.slice(1));
        break;
      case "db":
        await cmdDb(store, argv.slice(1));
        break;
      case "status":
        await cmdStatus(store);
        break;
      case "cleanup":
        await cmdCleanup(store);
        break;
      case "seed":
        await cmdSeed(store, argv.slice(1));
        break;
      default:
        printHelp(false);
        process.exit(1);
    }
  } finally {
    store.close();
  }
}
