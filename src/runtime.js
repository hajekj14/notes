const fs = require("fs/promises");

const { initializeStore } = require("./store");

async function ensureRuntimeData(config) {
  await Promise.all([
    fs.mkdir(config.dataRoot, { recursive: true }),
    fs.mkdir(config.paths.backupSnapshotRoot, { recursive: true })
  ]);

  return initializeStore(config);
}

module.exports = {
  ensureRuntimeData
};