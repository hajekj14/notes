const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const express = require("express");

const {
  asyncHandler,
  getCurrentUser,
  requireAdmin,
  requireAuth,
  setFlash
} = require("./auth");
const { renderMarkdown } = require("./markdown");
const {
  formatHumanDate,
  formatTimestamp,
  getMonthLabel,
  getTodayString,
  normalizeMonth,
  normalizeYear,
  parseDateInput
} = require("./date-utils");
const {
  changeUserPassword,
  createManagedUser,
  getEditorNote,
  getUserById,
  getViewableNoteById,
  listAccessibleMonths,
  listAccessibleYears,
  listNoteFeed,
  listShareCandidates,
  listUsers,
  saveAccessibleNoteById,
  saveOwnNoteForDate,
  setUserAdmin,
  updateNoteShares,
  writeDatabaseSnapshot
} = require("./store");

function createAppRouter(config) {
  const router = express.Router();

  router.use(requireAuth);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const user = getCurrentUser(req);
      const fallbackDate = parseDateInput(req.query.date) || parseDateInput(getTodayString());
      const requestedNoteId = normalizePositiveInteger(req.query.note);
      const note = getEditorNote(user, requestedNoteId, fallbackDate.value);

      if (!note && requestedNoteId) {
        setFlash(req, "error", "The selected note could not be opened.");
        return res.redirect("/notes");
      }

      const selectedDate = parseDateInput((note && note.noteDate) || fallbackDate.value);
      const shareCandidates = note && note.id && note.isOwned
        ? listShareCandidates(note.id, user.id)
        : [];

      return res.render("app", buildEditorPageModel({
        appTitle: config.appName,
        currentUser: user,
        selectedDate,
        note,
        shareCandidates
      }));
    })
  );

  router.get(
    "/notes",
    asyncHandler(async (req, res) => {
      const user = getCurrentUser(req);
      const activeYear = normalizeYear(req.query.year);
      const activeMonth = activeYear ? normalizeMonth(req.query.month) : null;
      const currentPage = normalizePage(req.query.page);

      const years = listAccessibleYears(user.id);
      const months = activeYear ? listAccessibleMonths(user.id, activeYear) : [];
      const feed = listNoteFeed(user.id, {
        year: activeYear,
        month: activeMonth,
        page: currentPage,
        pageSize: 12
      });

      return res.render("feed", buildFeedPageModel({
        appTitle: config.appName,
        currentUser: user,
        feed,
        activeYear,
        activeMonth,
        years,
        months
      }));
    })
  );

  router.get(
    "/profile",
    asyncHandler(async (req, res) => {
      const currentUser = getCurrentUser(req);

      return res.render("profile", buildProfilePageModel({
        appTitle: config.appName,
        currentUser
      }));
    })
  );

  router.get(
    "/notes/view/:noteId",
    asyncHandler(async (req, res) => {
      const user = getCurrentUser(req);
      const requestedNoteId = normalizePositiveInteger(req.params.noteId);

      if (!requestedNoteId) {
        setFlash(req, "error", "The requested note is not valid.");
        return res.redirect("/notes");
      }

      const note = getViewableNoteById(user.id, requestedNoteId);

      if (!note) {
        setFlash(req, "error", "The requested note could not be found.");
        return res.redirect("/notes");
      }

      const selectedDate = parseDateInput(note.noteDate);

      return res.render("note", buildNotePageModel({
        appTitle: config.appName,
        currentUser: user,
        selectedDate,
        note
      }));
    })
  );

  router.post(
    "/notes/save",
    asyncHandler(async (req, res) => {
      const user = getCurrentUser(req);
      const selectedDate = parseDateInput(req.body.date);
      const requestedNoteId = normalizePositiveInteger(req.body.noteId);

      if (!selectedDate) {
        setFlash(req, "error", "Enter a valid date in YYYY-MM-DD format.");
        return res.redirect(requestedNoteId ? buildEditorHref({ noteId: requestedNoteId }) : "/");
      }

      const content = typeof req.body.content === "string" ? req.body.content : "";
      let result;

      try {
        result = requestedNoteId
          ? saveAccessibleNoteById(user.id, requestedNoteId, selectedDate.value, content)
          : saveOwnNoteForDate(user.id, selectedDate.value, content);
      } catch (error) {
        setFlash(req, "error", error.message || "The note could not be saved.");
        return res.redirect(requestedNoteId ? buildEditorHref({ noteId: requestedNoteId }) : buildEditorHref({ date: selectedDate.value }));
      }

      setFlash(
        req,
        "success",
        result.deleted
          ? `Cleared the note for ${selectedDate.value}.`
          : `Saved the note for ${selectedDate.value}.`
      );

      if (result.deleted) {
        if (result.isOwned) {
          return res.redirect(buildEditorHref({ date: result.noteDate }));
        }

        return res.redirect("/notes");
      }

      return res.redirect(buildEditorHref({ noteId: result.noteId }));
    })
  );

  router.post(
    "/notes/share",
    asyncHandler(async (req, res) => {
      const user = getCurrentUser(req);
      const requestedNoteId = normalizePositiveInteger(req.body.noteId);

      if (!requestedNoteId) {
        setFlash(req, "error", "Save the note before updating sharing.");
        return res.redirect("/");
      }

      try {
        const updatedShares = updateNoteShares(requestedNoteId, user.id, req.body.sharedUserIds);
        const sharedCount = updatedShares.filter((entry) => entry.isShared).length;
        setFlash(req, "success", sharedCount > 0 ? `Updated sharing for ${sharedCount} user(s).` : "Sharing removed for this note.");
      } catch (error) {
        setFlash(req, "error", error.message || "The note sharing settings could not be saved.");
      }

      return res.redirect(buildEditorHref({ noteId: requestedNoteId }));
    })
  );

  router.post(
    ["/profile/password", "/account/password"],
    asyncHandler(async (req, res) => {
      const currentUser = getCurrentUser(req);
      const currentPassword = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
      const nextPassword = typeof req.body.nextPassword === "string" ? req.body.nextPassword : "";
      const confirmPassword = typeof req.body.confirmPassword === "string" ? req.body.confirmPassword : "";

      if (!nextPassword || !confirmPassword) {
        setFlash(req, "error", "Enter the new password twice.");
        return res.redirect("/profile");
      }

      if (nextPassword !== confirmPassword) {
        setFlash(req, "error", "The new password confirmation does not match.");
        return res.redirect("/profile");
      }

      try {
        await changeUserPassword(currentUser.id, currentPassword, nextPassword);
        setFlash(req, "success", "Updated your password.");
      } catch (error) {
        setFlash(req, "error", error.message || "The password could not be updated.");
      }

      return res.redirect("/profile");
    })
  );

  router.get(
    "/admin/users",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const currentUser = getCurrentUser(req);
      const users = listUsers();
      const adminCount = users.filter((entry) => entry.isAdmin).length;

      return res.render("admin-users", buildAdminUsersPageModel({
        appTitle: config.appName,
        currentUser,
        users,
        adminCount
      }));
    })
  );

  router.get(
    "/admin/database/download",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const snapshotPath = path.join(os.tmpdir(), `pocket-notes-${randomUUID()}.sqlite`);
      const downloadName = `pocket-notes-${buildSnapshotTimestamp()}.sqlite`;

      try {
        writeDatabaseSnapshot(snapshotPath);

        await new Promise((resolve, reject) => {
          res.download(snapshotPath, downloadName, (error) => {
            fs.unlink(snapshotPath).catch(() => {});

            if (error && !res.headersSent) {
              reject(error);
              return;
            }

            resolve();
          });
        });
      } catch (error) {
        await fs.unlink(snapshotPath).catch(() => {});
        throw error;
      }
    })
  );

  router.post(
    "/admin/users",
    requireAdmin,
    asyncHandler(async (req, res) => {
      try {
        await createManagedUser({
          username: req.body.username,
          displayName: req.body.displayName,
          password: req.body.password,
          isAdmin: req.body.isAdmin === "on"
        });

        setFlash(req, "success", "Created the new user account.");
      } catch (error) {
        setFlash(req, "error", error.message || "The user account could not be created.");
      }

      return res.redirect("/admin/users");
    })
  );

  router.post(
    "/admin/users/:userId/admin",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const currentUser = getCurrentUser(req);
      const targetUserId = normalizePositiveInteger(req.params.userId);
      const nextIsAdmin = req.body.isAdmin === "1";

      if (!targetUserId) {
        setFlash(req, "error", "The selected user is not valid.");
        return res.redirect("/admin/users");
      }

      try {
        const updatedUser = setUserAdmin(targetUserId, nextIsAdmin);

        if (updatedUser && updatedUser.id === currentUser.id) {
          req.session.user = toSessionUser(updatedUser);
        }

        setFlash(
          req,
          "success",
          nextIsAdmin
            ? `Granted admin access to ${updatedUser.displayName}.`
            : `Removed admin access from ${updatedUser.displayName}.`
        );
      } catch (error) {
        setFlash(req, "error", error.message || "The admin role could not be updated.");
      }

      return res.redirect("/admin/users");
    })
  );

  return router;
}

function buildEditorHref({ date, noteId }) {
  const searchParams = new URLSearchParams();

  if (noteId) {
    searchParams.set("note", String(noteId));
  } else if (date) {
    searchParams.set("date", date);
  }

  const queryString = searchParams.toString();
  return queryString ? `/?${queryString}` : "/";
}

function buildNoteViewHref(noteId) {
  return `/notes/view/${encodeURIComponent(String(noteId))}`;
}

function buildFeedHref({ year, month, page }) {
  const searchParams = new URLSearchParams();

  if (year) {
    searchParams.set("year", year);
  }

  if (month) {
    searchParams.set("month", month);
  }

  if (page && page > 1) {
    searchParams.set("page", String(page));
  }

  const queryString = searchParams.toString();
  return queryString ? `/notes?${queryString}` : "/notes";
}

function buildEditorPageModel({
  appTitle,
  currentUser,
  selectedDate,
  note,
  shareCandidates
}) {
  const effectiveNote = note || {
    id: null,
    content: "",
    exists: false,
    isOwned: true,
    ownerDisplayName: currentUser.displayName,
    ownerUsername: currentUser.username,
    shareCount: 0
  };

  return {
    appTitle,
    pageTitle: `${appTitle} · Editor`,
    selectedDate,
    note: effectiveNote,
    noteDateLabel: formatHumanDate(selectedDate),
    noteStatus: effectiveNote.exists
      ? formatTimestamp(effectiveNote.modifiedAt)
      : "No note saved for this day yet.",
    primaryNav: buildPrimaryNav("editor", currentUser.isAdmin),
    noteOwnershipLabel: effectiveNote.isOwned
      ? effectiveNote.shareCount > 0
        ? `Shared with ${effectiveNote.shareCount} user${effectiveNote.shareCount === 1 ? "" : "s"}.`
        : "Visible only to you right now."
      : `Shared by ${effectiveNote.ownerDisplayName}. Changes will update the shared note.` ,
    sharePanel: {
      canManage: Boolean(effectiveNote.id && effectiveNote.isOwned),
      readyToShare: Boolean(effectiveNote.id),
      options: shareCandidates,
      hasOptions: shareCandidates.length > 0
    }
  };
}

function buildFeedPageModel({
  appTitle,
  currentUser,
  feed,
  activeYear,
  activeMonth,
  years,
  months
}) {
  return {
    appTitle,
    pageTitle: `${appTitle} · Notes`,
    primaryNav: buildPrimaryNav("feed", currentUser.isAdmin),
    filterSummary: buildFilterSummary(feed.totalCount, activeYear, activeMonth),
    filters: {
      hasYear: Boolean(activeYear),
      hasMonth: Boolean(activeMonth),
      clearHref: buildFeedHref({}),
      wholeYearHref: activeYear ? buildFeedHref({ year: activeYear }) : null,
      years: years.map((year) => ({
        label: year,
        active: year === activeYear,
        href: buildFeedHref({ year })
      })),
      months: months.map((month) => ({
        label: getMonthLabel(month),
        shortLabel: month,
        active: month === activeMonth,
        href: buildFeedHref({ year: activeYear, month })
      }))
    },
    feed: {
      ...feed,
      items: feed.items.map((item) => ({
        ...item,
        dateLabel: formatHumanDate(item.noteDate),
        ownershipLabel: item.isOwned ? "Your note" : `Shared by ${item.ownerDisplayName}`,
        viewHref: buildNoteViewHref(item.id),
        editHref: buildEditorHref({ noteId: item.id }),
        statusLabel: formatTimestamp(item.modifiedAt)
      })),
      previousPageHref: feed.hasPreviousPage
        ? buildFeedHref({ year: activeYear, month: activeMonth, page: feed.currentPage - 1 })
        : null,
      nextPageHref: feed.hasNextPage
        ? buildFeedHref({ year: activeYear, month: activeMonth, page: feed.currentPage + 1 })
        : null
    }
  };
}

function buildProfilePageModel({
  appTitle,
  currentUser
}) {
  return {
    appTitle,
    currentUser,
    pageTitle: `${appTitle} · Profile`,
    primaryNav: buildPrimaryNav("profile", currentUser.isAdmin),
    roleLabel: currentUser.isAdmin ? "Admin" : "User"
  };
}

function buildNotePageModel({
  appTitle,
  currentUser,
  selectedDate,
  note
}) {
  return {
    appTitle,
    pageTitle: `${appTitle} · ${selectedDate.value}`,
    primaryNav: buildPrimaryNav("feed", currentUser.isAdmin),
    noteDateLabel: formatHumanDate(selectedDate),
    noteStatus: formatTimestamp(note.modifiedAt),
    noteOwnershipLabel: note.isOwned ? "Your note" : `Shared by ${note.ownerDisplayName}`,
    noteHtml: renderMarkdown(note.content),
    editHref: buildEditorHref({ noteId: note.id }),
    backHref: "/notes"
  };
}

function buildAdminUsersPageModel({
  appTitle,
  currentUser,
  users,
  adminCount
}) {
  return {
    appTitle,
    pageTitle: `${appTitle} · Admin`,
    primaryNav: buildPrimaryNav("admin", currentUser.isAdmin),
    databaseDownloadHref: "/admin/database/download",
    users: users.map((user) => ({
      ...user,
      adminActionLabel: user.isAdmin ? "Remove admin" : "Make admin",
      nextAdminValue: user.isAdmin ? "0" : "1",
      canToggleAdmin: !(user.isAdmin && adminCount === 1)
    }))
  };
}

function buildPrimaryNav(currentPage, isAdmin) {
  const items = [
    {
      label: "Editor",
      href: "/",
      active: currentPage === "editor"
    },
    {
      label: "Notes",
      href: "/notes",
      active: currentPage === "feed"
    },
    {
      label: "Profile",
      href: "/profile",
      active: currentPage === "profile"
    }
  ];

  if (isAdmin) {
    items.push({
      label: "Admin",
      href: "/admin/users",
      active: currentPage === "admin"
    });
  }

  return items;
}

function buildFilterSummary(totalCount, activeYear, activeMonth) {
  if (totalCount === 0) {
    return "No saved notes match this view yet.";
  }

  if (activeYear && activeMonth) {
    return `Showing ${totalCount} saved note${totalCount === 1 ? "" : "s"} for ${getMonthLabel(activeMonth)} ${activeYear}.`;
  }

  if (activeYear) {
    return `Showing ${totalCount} saved note${totalCount === 1 ? "" : "s"} for ${activeYear}.`;
  }

  return `Showing ${totalCount} saved note${totalCount === 1 ? "" : "s"}, newest first.`;
}

function normalizePage(input) {
  const numeric = Number(input);

  if (!Number.isInteger(numeric) || numeric < 1) {
    return 1;
  }

  return numeric;
}

function normalizePositiveInteger(input) {
  const numeric = Number(input);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function buildSnapshotTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin
  };
}

module.exports = {
  createAppRouter
};