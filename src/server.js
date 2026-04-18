const cookieSession = require("cookie-session");
const express = require("express");
const morgan = require("morgan");
const path = require("path");

const { consumeFlash, createAuthRouter, getCurrentUser, validateUserStore } = require("./auth");
const { getConfig } = require("./config");
const { createAppRouter } = require("./routes");
const { ensureRuntimeData } = require("./runtime");

async function start() {
  const config = getConfig();
  const runtimeInfo = await ensureRuntimeData(config);
  await validateUserStore(config);

  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(morgan("tiny"));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(
    cookieSession({
      name: "pocket-notes-session",
      keys: [config.sessionSecret],
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      sameSite: "lax",
      secure: config.sessionSecure
    })
  );
  app.use(
    "/static",
    express.static(path.join(__dirname, "public"), {
      maxAge: config.sessionSecure ? "7d" : 0
    })
  );

  app.use((req, res, next) => {
    res.locals.appTitle = config.appName;
    res.locals.currentUser = getCurrentUser(req);
    res.locals.flash = consumeFlash(req);
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use(createAuthRouter(config));
  app.use(createAppRouter(config));

  app.use((err, req, res, next) => {
    console.error(err);

    if (res.headersSent) {
      return next(err);
    }

    res.status(500);
    return res.render("error", {
      pageTitle: "Server Error",
      heading: "Something went wrong",
      message: "The server could not complete your request. Check the logs and try again."
    });
  });

  const server = app.listen(config.port, () => {
    console.log(`${config.appName} listening on http://0.0.0.0:${config.port}`);

    if (runtimeInfo.seededDefaultUser) {
      console.log(
        `Created default admin \"${runtimeInfo.seededUsername}\" with password \"${runtimeInfo.seededPassword}\" in ${runtimeInfo.databaseFile}.`
      );
    }
  });

  return server;
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  start
};