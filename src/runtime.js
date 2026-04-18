const fs = require("fs/promises");

const { initializeStore } = require("./store");

async function ensureRuntimeData(config) {
  await Promise.all([
    fs.mkdir(config.dataRoot, { recursive: true }),
    fs.mkdir(config.paths.syncRoot, { recursive: true })
  ]);

  await ensureExampleFile(
    config.paths.repoRcloneExampleFile,
    config.paths.rcloneExampleFile,
    defaultRcloneExampleText()
  );

  return initializeStore(config);
}

async function ensureExampleFile(sourcePath, targetPath, fallbackText) {
  if (await fileExists(targetPath)) {
    return;
  }

  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await fs.writeFile(targetPath, fallbackText, "utf8");
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function defaultRcloneExampleText() {
  return [
    "[gdrive]",
    "type = drive",
    "scope = drive.file",
    "token = {\"access_token\":\"paste-access-token-here\",\"token_type\":\"Bearer\",\"refresh_token\":\"paste-refresh-token-here\",\"expiry\":\"2030-01-01T00:00:00.000000000Z\"}",
    "root_folder_id =",
    ""
  ].join("\n");
}

module.exports = {
  ensureRuntimeData
};