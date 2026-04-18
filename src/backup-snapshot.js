const fs = require("fs/promises");
const path = require("path");

const { getConfig } = require("./config");
const { ensureRuntimeData } = require("./runtime");
const { writeDatabaseSnapshot } = require("./store");

const SNAPSHOT_FILE_PATTERN = /^pocket-notes-\d{4}-\d{2}-\d{2}T.*\.sqlite$/;

let shouldStop = false;

process.on("SIGINT", () => {
  shouldStop = true;
});

process.on("SIGTERM", () => {
  shouldStop = true;
});

async function main() {
  const mode = process.argv[2] === "watch" ? "watch" : "once";
  const config = getConfig();

  await initializeSnapshotExporter(config);

  if (mode === "watch") {
    await runWatchLoop(config);
    return;
  }

  await exportSnapshot(config);
}

async function initializeSnapshotExporter(config) {
  await ensureRuntimeData(config);
  await fs.mkdir(config.paths.backupSnapshotRoot, { recursive: true });
}

async function runWatchLoop(config) {
  while (!shouldStop) {
    try {
      await exportSnapshot(config);
    } catch (error) {
      console.error("Snapshot export failed.");
      console.error(error);
    }

    if (shouldStop) {
      break;
    }

    await delay(config.backupSnapshots.intervalMs);
  }
}

async function exportSnapshot(config) {
  const fileName = `pocket-notes-${buildSnapshotTimestamp()}.sqlite`;
  const outputFilePath = path.join(config.paths.backupSnapshotRoot, fileName);

  writeDatabaseSnapshot(outputFilePath);
  await pruneOldSnapshots(config.paths.backupSnapshotRoot, config.backupSnapshots.keepCount);

  console.log(`Created SQLite snapshot at ${outputFilePath}.`);
  return outputFilePath;
}

async function pruneOldSnapshots(snapshotRoot, keepCount) {
  const entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
  const snapshotNames = entries
    .filter((entry) => entry.isFile() && SNAPSHOT_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const removableNames = snapshotNames.slice(keepCount);

  await Promise.all(
    removableNames.map((name) => fs.unlink(path.join(snapshotRoot, name)).catch(() => {}))
  );
}

function buildSnapshotTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});