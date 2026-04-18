const path = require("path");

function getConfig() {
  const appRoot = path.resolve(__dirname, "..");
  const port = Number(process.env.PORT || 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port number.");
  }

  const dataRoot = path.resolve(process.env.NOTES_DATA_ROOT || path.join(appRoot, "runtime-data"));

  return {
    appRoot,
    appName: "Pocket Notes",
    port,
    dataRoot,
    sessionSecret: process.env.SESSION_SECRET || "development-secret-change-me",
    sessionSecure: process.env.SESSION_SECURE === "true",
    defaultUserPassword: process.env.DEFAULT_USER_PASSWORD || "changeme",
    paths: {
      syncRoot: path.join(dataRoot, "sync"),
      databaseFile: path.join(dataRoot, "pocket-notes.sqlite"),
      rcloneExampleFile: path.join(dataRoot, "sync", "rclone.conf.example"),
      repoRcloneExampleFile: path.join(appRoot, "data", "config", "rclone.conf.example")
    }
  };
}

module.exports = {
  getConfig
};