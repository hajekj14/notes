const path = require("path");

function getConfig() {
  const appRoot = path.resolve(__dirname, "..");
  const port = Number(process.env.PORT || 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port number.");
  }

  const dataRoot = path.resolve(process.env.NOTES_DATA_ROOT || path.join(appRoot, "runtime-data"));
  const loginRateLimitMaxAttempts = parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 8);
  const loginRateLimitWindowSeconds = parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS, 900);
  const backupSnapshotIntervalSeconds = parsePositiveInteger(process.env.BACKUP_SNAPSHOT_INTERVAL_SECONDS, 900);
  const backupSnapshotKeepCount = parsePositiveInteger(process.env.BACKUP_SNAPSHOT_KEEP_COUNT, 14);

  return {
    appRoot,
    appName: "Pocket Notes",
    port,
    dataRoot,
    sessionSecret: process.env.SESSION_SECRET || "development-secret-change-me",
    sessionSecure: process.env.SESSION_SECURE === "true",
    defaultUserPassword: process.env.DEFAULT_USER_PASSWORD || "changeme",
    loginRateLimit: {
      maxAttempts: loginRateLimitMaxAttempts,
      windowMs: loginRateLimitWindowSeconds * 1000
    },
    backupSnapshots: {
      intervalMs: backupSnapshotIntervalSeconds * 1000,
      keepCount: backupSnapshotKeepCount
    },
    paths: {
      databaseFile: path.join(dataRoot, "pocket-notes.sqlite"),
      backupSnapshotRoot: path.join(dataRoot, "backup-snapshots")
    }
  };
}

function parsePositiveInteger(input, fallbackValue) {
  const numeric = Number(input);

  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallbackValue;
  }

  return numeric;
}

module.exports = {
  getConfig
};