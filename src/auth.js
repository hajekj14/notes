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
  const failedLoginLimiter = createFailedLoginLimiter(config.loginRateLimit);

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
      const clientKey = getFailedLoginKey(req);
      const activeLimit = failedLoginLimiter.getState(clientKey);

      if (activeLimit.blocked) {
        return renderRateLimitedLogin(res, activeLimit.retryAfterMs);
      }

      const username = normalizeUsername(req.body.username);
      const password = typeof req.body.password === "string" ? req.body.password : "";

      if (!username || !password) {
        const nextLimit = failedLoginLimiter.recordFailure(clientKey);

        if (nextLimit.blocked) {
          return renderRateLimitedLogin(res, nextLimit.retryAfterMs);
        }

        setFlash(req, "error", "Enter a valid username and password.");
        return res.redirect("/login");
      }

      const user = await verifyCredentials(config, username, password);

      if (!user) {
        const nextLimit = failedLoginLimiter.recordFailure(clientKey);

        if (nextLimit.blocked) {
          return renderRateLimitedLogin(res, nextLimit.retryAfterMs);
        }

        setFlash(req, "error", "The username or password is not correct.");
        return res.redirect("/login");
      }

      failedLoginLimiter.recordSuccess(clientKey);
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

function createFailedLoginLimiter(settings = {}) {
  const maxAttempts = normalizePositiveInteger(settings.maxAttempts, 8);
  const windowMs = normalizePositiveInteger(settings.windowMs, 15 * 60 * 1000);
  const attempts = new Map();

  return {
    getState(key) {
      const now = Date.now();
      pruneExpiredAttempts(attempts, windowMs, now);
      return buildAttemptState(attempts.get(key), maxAttempts, windowMs, now);
    },
    recordFailure(key) {
      const now = Date.now();
      pruneExpiredAttempts(attempts, windowMs, now);
      const currentRecord = attempts.get(key);
      const currentState = buildAttemptState(currentRecord, maxAttempts, windowMs, now);

      if (currentState.blocked) {
        return currentState;
      }

      const nextRecord = currentRecord && currentRecord.windowStartedAt && now - currentRecord.windowStartedAt < windowMs
        ? {
          windowStartedAt: currentRecord.windowStartedAt,
          failedCount: currentRecord.failedCount + 1,
          blockedUntil: 0
        }
        : {
          windowStartedAt: now,
          failedCount: 1,
          blockedUntil: 0
        };

      if (nextRecord.failedCount >= maxAttempts) {
        nextRecord.blockedUntil = now + windowMs;
        nextRecord.windowStartedAt = 0;
        nextRecord.failedCount = 0;
      }

      attempts.set(key, nextRecord);
      return buildAttemptState(nextRecord, maxAttempts, windowMs, now);
    },
    recordSuccess(key) {
      attempts.delete(key);
    }
  };
}

function pruneExpiredAttempts(attempts, windowMs, now) {
  attempts.forEach((record, key) => {
    if (record.blockedUntil && record.blockedUntil <= now) {
      attempts.delete(key);
      return;
    }

    if (!record.blockedUntil && record.windowStartedAt && now - record.windowStartedAt >= windowMs) {
      attempts.delete(key);
    }
  });
}

function buildAttemptState(record, maxAttempts, windowMs, now) {
  if (!record) {
    return {
      blocked: false,
      retryAfterMs: 0,
      remainingAttempts: maxAttempts
    };
  }

  if (record.blockedUntil && record.blockedUntil > now) {
    return {
      blocked: true,
      retryAfterMs: record.blockedUntil - now,
      remainingAttempts: 0
    };
  }

  if (!record.windowStartedAt || now - record.windowStartedAt >= windowMs) {
    return {
      blocked: false,
      retryAfterMs: 0,
      remainingAttempts: maxAttempts
    };
  }

  return {
    blocked: false,
    retryAfterMs: 0,
    remainingAttempts: Math.max(maxAttempts - record.failedCount, 0)
  };
}

function getFailedLoginKey(req) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

function renderRateLimitedLogin(res, retryAfterMs) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  res.set("Retry-After", String(retryAfterSeconds));
  res.status(429);
  return res.render("login", {
    pageTitle: "Sign In",
    flash: {
      kind: "error",
      message: `Too many failed sign-in attempts. Try again in ${formatRetryAfter(retryAfterMs)}.`
    }
  });
}

function formatRetryAfter(retryAfterMs) {
  const totalSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
  }

  const minutes = Math.ceil(totalSeconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function normalizePositiveInteger(input, fallbackValue) {
  const numeric = Number(input);

  if (!Number.isInteger(numeric) || numeric < 1) {
    return fallbackValue;
  }

  return numeric;
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