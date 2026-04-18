const bcrypt = require("bcryptjs");
const express = require("express");

const { getUserByUsername, validateStore } = require("./store");

const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createAuthRouter(config) {
  const router = express.Router();

  router.get("/login", (req, res) => {
    if (getCurrentUser(req)) {
      return res.redirect("/");
    }

    return res.render("login", {
      pageTitle: "Sign In"
    });
  });

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const username = normalizeUsername(req.body.username);
      const password = typeof req.body.password === "string" ? req.body.password : "";

      if (!username || !password) {
        setFlash(req, "error", "Enter a valid username and password.");
        return res.redirect("/login");
      }

      const user = await verifyCredentials(config, username, password);

      if (!user) {
        setFlash(req, "error", "The username or password is not correct.");
        return res.redirect("/login");
      }

      req.session.user = user;
      setFlash(req, "success", `Signed in as ${user.displayName}.`);
      return res.redirect("/");
    })
  );

  router.post("/logout", (req, res) => {
    req.session = null;
    return res.redirect("/login");
  });

  return router;
}

function consumeFlash(req) {
  if (!req.session || !req.session.flash) {
    return null;
  }

  const flash = req.session.flash;
  delete req.session.flash;
  return flash;
}

function getCurrentUser(req) {
  return req.session && req.session.user ? req.session.user : null;
}

function normalizeUsername(input) {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  return USERNAME_PATTERN.test(value) ? value : "";
}

function requireAuth(req, res, next) {
  if (getCurrentUser(req)) {
    return next();
  }

  setFlash(req, "error", "Sign in to continue.");
  return res.redirect("/login");
}

function requireAdmin(req, res, next) {
  const currentUser = getCurrentUser(req);

  if (currentUser && currentUser.isAdmin) {
    return next();
  }

  setFlash(req, "error", "Admin access is required for that page.");
  return res.redirect("/");
}

function setFlash(req, kind, message) {
  req.session.flash = {
    kind,
    message
  };
}

async function validateUserStore(config) {
  validateStore();
}

async function verifyCredentials(config, username, password) {
  const user = getUserByUsername(username);

  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin
  };
}

module.exports = {
  asyncHandler,
  consumeFlash,
  createAuthRouter,
  getCurrentUser,
  normalizeUsername,
  requireAdmin,
  requireAuth,
  setFlash,
  validateUserStore
};