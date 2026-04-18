const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const { buildMarkdownPreview } = require("./markdown");

const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let database = null;

async function initializeStore(config) {
  if (database) {
    database.close();
  }

  database = new DatabaseSync(config.paths.databaseFile);
  configureDatabase(database);
  createSchema(database);

  const seededDefaultUser = await seedDefaultAdmin(config);

  return {
    databaseFile: config.paths.databaseFile,
    seededDefaultUser,
    seededUsername: seededDefaultUser ? "admin" : null,
    seededPassword: seededDefaultUser ? config.defaultUserPassword : null
  };
}

function listUsers() {
  return getDatabase()
    .prepare(
      `SELECT
         users.id,
         users.username,
         users.display_name AS displayName,
         users.password_hash AS passwordHash,
         users.is_admin AS isAdmin,
         users.created_at AS createdAt,
         users.updated_at AS updatedAt,
         (
           SELECT COUNT(*)
           FROM notes
           WHERE notes.owner_user_id = users.id
         ) AS ownedNoteCount
       FROM users
       ORDER BY users.is_admin DESC, users.username ASC`
    )
    .all()
    .map(mapUserRow);
}

function getUserById(userId) {
  const row = getDatabase()
    .prepare(
      `SELECT
         id,
         username,
         display_name AS displayName,
         password_hash AS passwordHash,
         is_admin AS isAdmin,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM users
       WHERE id = ?`
    )
    .get(normalizePositiveInteger(userId));

  return mapUserRow(row);
}

function getUserByUsername(username) {
  const normalized = normalizeUsername(username);

  if (!normalized) {
    return null;
  }

  const row = getDatabase()
    .prepare(
      `SELECT
         id,
         username,
         display_name AS displayName,
         password_hash AS passwordHash,
         is_admin AS isAdmin,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM users
       WHERE username = ?`
    )
    .get(normalized);

  return mapUserRow(row);
}

async function createManagedUser(input) {
  const username = normalizeUsername(input.username);
  const displayName = normalizeDisplayName(input.displayName, username);
  const password = typeof input.password === "string" ? input.password : "";
  const isAdmin = Boolean(input.isAdmin);

  if (!username) {
    throw createStoreError("invalid-username", "Username must use 3 to 32 lowercase letters, numbers, underscores, or hyphens.");
  }

  if (password.length < 6) {
    throw createStoreError("invalid-password", "Password must be at least 6 characters long.");
  }

  if (getUserByUsername(username)) {
    throw createStoreError("duplicate-user", `The username ${username} already exists.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const timestamp = nowIso();
  const info = getDatabase()
    .prepare(
      `INSERT INTO users (
         username,
         display_name,
         password_hash,
         is_admin,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(username, displayName, passwordHash, isAdmin ? 1 : 0, timestamp, timestamp);

  return getUserById(Number(info.lastInsertRowid));
}

async function changeUserPassword(userId, currentPassword, nextPassword) {
  const targetUserId = normalizePositiveInteger(userId);
  const existingUser = getUserById(targetUserId);
  const currentValue = typeof currentPassword === "string" ? currentPassword : "";
  const nextValue = typeof nextPassword === "string" ? nextPassword : "";

  if (!existingUser) {
    throw createStoreError("missing-user", "The selected user does not exist.");
  }

  if (!currentValue) {
    throw createStoreError("invalid-current-password", "Enter your current password.");
  }

  if (nextValue.length < 6) {
    throw createStoreError("invalid-password", "The new password must be at least 6 characters long.");
  }

  const currentMatches = await bcrypt.compare(currentValue, existingUser.passwordHash);

  if (!currentMatches) {
    throw createStoreError("invalid-current-password", "The current password is not correct.");
  }

  const nextMatchesCurrent = await bcrypt.compare(nextValue, existingUser.passwordHash);

  if (nextMatchesCurrent) {
    throw createStoreError("same-password", "Choose a new password that is different from the current password.");
  }

  const passwordHash = await bcrypt.hash(nextValue, 12);

  getDatabase()
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, nowIso(), targetUserId);

  return getUserById(targetUserId);
}

function setUserAdmin(userId, isAdmin) {
  const targetUserId = normalizePositiveInteger(userId);
  const nextIsAdmin = Boolean(isAdmin);
  const existingUser = getUserById(targetUserId);

  if (!existingUser) {
    throw createStoreError("missing-user", "The selected user does not exist.");
  }

  if (!nextIsAdmin && existingUser.isAdmin && countAdmins() <= 1) {
    throw createStoreError("last-admin", "At least one admin must remain in the system.");
  }

  getDatabase()
    .prepare("UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?")
    .run(nextIsAdmin ? 1 : 0, nowIso(), targetUserId);

  return getUserById(targetUserId);
}

function getEditorNote(currentUser, noteId, noteDate) {
  if (noteId) {
    return getAccessibleNoteById(currentUser.id, noteId);
  }

  const existingNote = getOwnNoteByDate(currentUser.id, noteDate);

  if (existingNote) {
    return existingNote;
  }

  return {
    id: null,
    noteDate,
    content: "",
    exists: false,
    modifiedAt: null,
    isOwned: true,
    ownerId: currentUser.id,
    ownerUsername: currentUser.username,
    ownerDisplayName: currentUser.displayName
  };
}

function getViewableNoteById(userId, noteId) {
  return getAccessibleNoteById(userId, noteId);
}

function saveOwnNoteForDate(userId, noteDate, content) {
  const normalizedDate = normalizeNoteDate(noteDate);
  const normalizedContent = normalizeNoteContent(content);
  const existingNote = getOwnNoteByDate(userId, normalizedDate);

  if (!normalizedContent.trim()) {
    if (existingNote) {
      deleteNote(existingNote.id);
    }

    return {
      deleted: Boolean(existingNote),
      noteId: null,
      noteDate: normalizedDate,
      ownerUserId: userId,
      isOwned: true
    };
  }

  if (existingNote) {
    getDatabase()
      .prepare("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?")
      .run(normalizedContent, nowIso(), existingNote.id);

    return {
      deleted: false,
      noteId: existingNote.id,
      noteDate: normalizedDate,
      ownerUserId: userId,
      isOwned: true
    };
  }

  const timestamp = nowIso();
  const info = getDatabase()
    .prepare(
      `INSERT INTO notes (
         owner_user_id,
         note_date,
         content,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, normalizedDate, normalizedContent, timestamp, timestamp);

  return {
    deleted: false,
    noteId: Number(info.lastInsertRowid),
    noteDate: normalizedDate,
    ownerUserId: userId,
    isOwned: true
  };
}

function saveAccessibleNoteById(userId, noteId, noteDate, content) {
  const normalizedDate = normalizeNoteDate(noteDate);
  const normalizedContent = normalizeNoteContent(content);
  const existingNote = getAccessibleNoteById(userId, noteId);

  if (!existingNote) {
    throw createStoreError("missing-note", "The selected note could not be found.");
  }

  const conflictingNote = getDatabase()
    .prepare(
      `SELECT id
       FROM notes
       WHERE owner_user_id = ?
         AND note_date = ?
         AND id != ?`
    )
    .get(existingNote.ownerId, normalizedDate, existingNote.id);

  if (conflictingNote) {
    throw createStoreError(
      "note-conflict",
      `A note for ${normalizedDate} already exists for ${existingNote.ownerDisplayName}.`
    );
  }

  if (!normalizedContent.trim()) {
    deleteNote(existingNote.id);

    return {
      deleted: true,
      noteId: null,
      noteDate: normalizedDate,
      ownerUserId: existingNote.ownerId,
      isOwned: existingNote.isOwned
    };
  }

  getDatabase()
    .prepare("UPDATE notes SET note_date = ?, content = ?, updated_at = ? WHERE id = ?")
    .run(normalizedDate, normalizedContent, nowIso(), existingNote.id);

  return {
    deleted: false,
    noteId: existingNote.id,
    noteDate: normalizedDate,
    ownerUserId: existingNote.ownerId,
    isOwned: existingNote.isOwned
  };
}

function listShareCandidates(noteId, ownerUserId) {
  const normalizedNoteId = normalizePositiveInteger(noteId);
  const normalizedOwnerId = normalizePositiveInteger(ownerUserId);

  const note = getDatabase()
    .prepare("SELECT id FROM notes WHERE id = ? AND owner_user_id = ?")
    .get(normalizedNoteId, normalizedOwnerId);

  if (!note) {
    throw createStoreError("share-denied", "Only the note owner can manage sharing.");
  }

  return getDatabase()
    .prepare(
      `SELECT
         users.id,
         users.username,
         users.display_name AS displayName,
         users.is_admin AS isAdmin,
         CASE WHEN note_shares.user_id IS NULL THEN 0 ELSE 1 END AS isShared
       FROM users
       LEFT JOIN note_shares
         ON note_shares.user_id = users.id
        AND note_shares.note_id = ?
       WHERE users.id != ?
       ORDER BY users.is_admin DESC, users.username ASC`
    )
    .all(normalizedNoteId, normalizedOwnerId)
    .map((row) => ({
      id: Number(row.id),
      username: row.username,
      displayName: row.displayName,
      isAdmin: Boolean(row.isAdmin),
      isShared: Boolean(row.isShared)
    }));
}

function updateNoteShares(noteId, ownerUserId, sharedUserIds) {
  const normalizedNoteId = normalizePositiveInteger(noteId);
  const normalizedOwnerId = normalizePositiveInteger(ownerUserId);
  const note = getDatabase()
    .prepare("SELECT id FROM notes WHERE id = ? AND owner_user_id = ?")
    .get(normalizedNoteId, normalizedOwnerId);

  if (!note) {
    throw createStoreError("share-denied", "Only the note owner can manage sharing.");
  }

  const selectedUserIds = uniquePositiveIntegers(sharedUserIds).filter((userId) => userId !== normalizedOwnerId);
  const validUserIds = selectedUserIds.length > 0
    ? getDatabase()
      .prepare(
        `SELECT id
         FROM users
         WHERE id IN (${selectedUserIds.map(() => "?").join(", ")})`
      )
      .all(...selectedUserIds)
      .map((row) => Number(row.id))
    : [];

  const insertShare = getDatabase().prepare(
    `INSERT INTO note_shares (
       note_id,
       user_id,
       created_at
     ) VALUES (?, ?, ?)`
  );

  getDatabase().exec("BEGIN IMMEDIATE");

  try {
    getDatabase().prepare("DELETE FROM note_shares WHERE note_id = ?").run(normalizedNoteId);

    validUserIds.forEach((userId) => {
      insertShare.run(normalizedNoteId, userId, nowIso());
    });

    getDatabase().exec("COMMIT");
  } catch (error) {
    getDatabase().exec("ROLLBACK");
    throw error;
  }

  return listShareCandidates(normalizedNoteId, normalizedOwnerId);
}

function writeDatabaseSnapshot(outputFilePath) {
  const targetPath = typeof outputFilePath === "string" ? outputFilePath.trim() : "";

  if (!targetPath) {
    throw createStoreError("invalid-snapshot-path", "The snapshot file path is not valid.");
  }

  getDatabase().exec(`VACUUM INTO ${quoteSqlString(targetPath)}`);
  return targetPath;
}

function listAccessibleYears(userId) {
  return getAccessibleDistinctParts(userId, "substr(notes.note_date, 1, 4)", "year");
}

function listAccessibleMonths(userId, year) {
  const normalizedYear = normalizeYear(year);

  return getAccessibleDistinctParts(
    userId,
    "substr(notes.note_date, 6, 2)",
    "month",
    "AND substr(notes.note_date, 1, 4) = ?",
    [normalizedYear]
  );
}

function listNoteFeed(userId, options = {}) {
  const normalizedUserId = normalizePositiveInteger(userId);
  const normalizedYear = options.year ? normalizeYear(options.year) : null;
  const normalizedMonth = options.month ? normalizeMonth(options.month) : null;
  const pageSize = normalizePositiveInteger(options.pageSize, 12);
  const requestedPage = normalizePositiveInteger(options.page, 1);

  const filterClause = [];
  const filterParams = [normalizedUserId, normalizedUserId];

  if (normalizedYear) {
    filterClause.push("substr(notes.note_date, 1, 4) = ?");
    filterParams.push(normalizedYear);
  }

  if (normalizedMonth) {
    filterClause.push("substr(notes.note_date, 6, 2) = ?");
    filterParams.push(normalizedMonth);
  }

  const whereClause = filterClause.length > 0
    ? `WHERE (notes.owner_user_id = ? OR note_shares.user_id = ?) AND ${filterClause.join(" AND ")}`
    : "WHERE notes.owner_user_id = ? OR note_shares.user_id = ?";

  const totalCount = Number(
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS totalCount
         FROM notes
         JOIN users owners ON owners.id = notes.owner_user_id
         LEFT JOIN note_shares
           ON note_shares.note_id = notes.id
          AND note_shares.user_id = ?
         ${whereClause}`
      )
          .get(normalizedUserId, ...filterParams).totalCount
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * pageSize;

  const rows = getDatabase()
    .prepare(
      `SELECT
         notes.id,
         notes.note_date AS noteDate,
         notes.content,
         notes.updated_at AS updatedAt,
         notes.owner_user_id AS ownerUserId,
         owners.username AS ownerUsername,
         owners.display_name AS ownerDisplayName,
         CASE WHEN notes.owner_user_id = ? THEN 1 ELSE 0 END AS isOwned
       FROM notes
       JOIN users owners ON owners.id = notes.owner_user_id
       LEFT JOIN note_shares
         ON note_shares.note_id = notes.id
        AND note_shares.user_id = ?
       ${whereClause}
       ORDER BY notes.note_date DESC, notes.updated_at DESC, notes.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(normalizedUserId, normalizedUserId, ...filterParams, pageSize, offset)
    .map((row) => {
      const preview = buildMarkdownPreview(row.content);

      return {
        id: Number(row.id),
        noteDate: row.noteDate,
        modifiedAt: row.updatedAt,
        isOwned: Boolean(row.isOwned),
        ownerId: Number(row.ownerUserId),
        ownerUsername: row.ownerUsername,
        ownerDisplayName: row.ownerDisplayName,
        previewHtml: preview.html,
        hasPreview: Boolean(preview.html),
        previewTruncated: preview.truncated
      };
    });

  return {
    items: rows,
    totalCount,
    totalPages,
    currentPage,
    pageSize,
    rangeStart: totalCount === 0 ? 0 : offset + 1,
    rangeEnd: totalCount === 0 ? 0 : offset + rows.length,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages
  };
}

function validateStore() {
  listUsers();
}

function configureDatabase(db) {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
}

function createSchema(db) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       username TEXT NOT NULL UNIQUE,
       display_name TEXT NOT NULL,
       password_hash TEXT NOT NULL,
       is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );

     CREATE TABLE IF NOT EXISTS notes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       note_date TEXT NOT NULL,
       content TEXT NOT NULL DEFAULT '',
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       UNIQUE (owner_user_id, note_date)
     );

     CREATE TABLE IF NOT EXISTS note_shares (
       note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
       user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       created_at TEXT NOT NULL,
       PRIMARY KEY (note_id, user_id)
     );

     CREATE INDEX IF NOT EXISTS idx_notes_owner_date
       ON notes (owner_user_id, note_date);

     CREATE INDEX IF NOT EXISTS idx_notes_date
       ON notes (note_date);

     CREATE INDEX IF NOT EXISTS idx_note_shares_user
       ON note_shares (user_id);
    `
  );
}

async function seedDefaultAdmin(config) {
  if (countUsers() > 0) {
    return false;
  }

  const passwordHash = await bcrypt.hash(config.defaultUserPassword, 12);
  const timestamp = nowIso();

  getDatabase()
    .prepare(
      `INSERT INTO users (
         username,
         display_name,
         password_hash,
         is_admin,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run("admin", "Administrator", passwordHash, 1, timestamp, timestamp);

  return true;
}

function getAccessibleNoteById(userId, noteId) {
  const normalizedUserId = normalizePositiveInteger(userId);
  const normalizedNoteId = normalizePositiveInteger(noteId);
  const row = getDatabase()
    .prepare(
      `SELECT
         notes.id,
         notes.note_date AS noteDate,
         notes.content,
         notes.updated_at AS updatedAt,
         notes.owner_user_id AS ownerUserId,
         owners.username AS ownerUsername,
         owners.display_name AS ownerDisplayName,
         CASE WHEN notes.owner_user_id = ? THEN 1 ELSE 0 END AS isOwned,
         (
           SELECT COUNT(*)
           FROM note_shares
           WHERE note_shares.note_id = notes.id
         ) AS shareCount
       FROM notes
       JOIN users owners ON owners.id = notes.owner_user_id
       LEFT JOIN note_shares
         ON note_shares.note_id = notes.id
        AND note_shares.user_id = ?
       WHERE notes.id = ?
         AND (notes.owner_user_id = ? OR note_shares.user_id = ?)`
    )
    .get(normalizedUserId, normalizedUserId, normalizedNoteId, normalizedUserId, normalizedUserId);

  return mapNoteRow(row);
}

function getOwnNoteByDate(userId, noteDate) {
  const normalizedUserId = normalizePositiveInteger(userId);
  const normalizedDate = normalizeNoteDate(noteDate);
  const row = getDatabase()
    .prepare(
      `SELECT
         notes.id,
         notes.note_date AS noteDate,
         notes.content,
         notes.updated_at AS updatedAt,
         notes.owner_user_id AS ownerUserId,
         owners.username AS ownerUsername,
         owners.display_name AS ownerDisplayName,
         1 AS isOwned,
         (
           SELECT COUNT(*)
           FROM note_shares
           WHERE note_shares.note_id = notes.id
         ) AS shareCount
       FROM notes
       JOIN users owners ON owners.id = notes.owner_user_id
       WHERE notes.owner_user_id = ?
         AND notes.note_date = ?`
    )
    .get(normalizedUserId, normalizedDate);

  return mapNoteRow(row);
}

function getAccessibleDistinctParts(userId, expression, alias, extraWhereClause = "", extraParams = []) {
  const normalizedUserId = normalizePositiveInteger(userId);

  return getDatabase()
    .prepare(
      `SELECT DISTINCT ${expression} AS ${alias}
       FROM notes
       LEFT JOIN note_shares
         ON note_shares.note_id = notes.id
        AND note_shares.user_id = ?
       WHERE (notes.owner_user_id = ? OR note_shares.user_id = ?)
         ${extraWhereClause}
       ORDER BY ${alias} DESC`
    )
    .all(normalizedUserId, normalizedUserId, normalizedUserId, ...extraParams)
    .map((row) => row[alias]);
}

function deleteNote(noteId) {
  getDatabase().prepare("DELETE FROM notes WHERE id = ?").run(normalizePositiveInteger(noteId));
}

function countUsers() {
  return Number(getDatabase().prepare("SELECT COUNT(*) AS totalCount FROM users").get().totalCount);
}

function countNotes() {
  return Number(getDatabase().prepare("SELECT COUNT(*) AS totalCount FROM notes").get().totalCount);
}

function countAdmins() {
  return Number(getDatabase().prepare("SELECT COUNT(*) AS totalCount FROM users WHERE is_admin = 1").get().totalCount);
}

function getDatabase() {
  if (!database) {
    throw new Error("The SQLite store has not been initialized.");
  }

  return database;
}

function mapNoteRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    noteDate: row.noteDate,
    content: row.content,
    exists: true,
    modifiedAt: row.updatedAt,
    isOwned: Boolean(row.isOwned),
    ownerId: Number(row.ownerUserId),
    ownerUsername: row.ownerUsername,
    ownerDisplayName: row.ownerDisplayName,
    shareCount: Number(row.shareCount || 0)
  };
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    isAdmin: Boolean(row.isAdmin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ownedNoteCount: Number(row.ownedNoteCount || 0)
  };
}

function createStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeDisplayName(displayName, fallbackValue) {
  const trimmed = typeof displayName === "string" ? displayName.trim() : "";
  return trimmed || fallbackValue;
}

function normalizeMonth(value) {
  const input = typeof value === "string" ? value.trim() : "";

  if (!/^(0[1-9]|1[0-2])$/.test(input)) {
    throw createStoreError("invalid-month", "The month filter is not valid.");
  }

  return input;
}

function normalizeNoteContent(content) {
  return typeof content === "string" ? content.replace(/\r\n/g, "\n") : "";
}

function normalizeNoteDate(noteDate) {
  const input = typeof noteDate === "string" ? noteDate.trim() : "";

  if (!DATE_PATTERN.test(input)) {
    throw createStoreError("invalid-date", "The note date is not valid.");
  }

  return input;
}

function normalizePositiveInteger(value, fallbackValue = null) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 1) {
    if (fallbackValue !== null) {
      return fallbackValue;
    }

    throw createStoreError("invalid-id", "The provided identifier is not valid.");
  }

  return numeric;
}

function normalizeUsername(username) {
  const input = typeof username === "string" ? username.trim().toLowerCase() : "";
  return USERNAME_PATTERN.test(input) ? input : "";
}

function normalizeYear(value) {
  const input = typeof value === "string" ? value.trim() : "";

  if (!/^\d{4}$/.test(input)) {
    throw createStoreError("invalid-year", "The year filter is not valid.");
  }

  return input;
}

function uniquePositiveIntegers(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(list.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

module.exports = {
  changeUserPassword,
  createManagedUser,
  getEditorNote,
  getUserById,
  getUserByUsername,
  getViewableNoteById,
  initializeStore,
  listAccessibleMonths,
  listAccessibleYears,
  listNoteFeed,
  listShareCandidates,
  listUsers,
  saveAccessibleNoteById,
  saveOwnNoteForDate,
  setUserAdmin,
  updateNoteShares,
  validateStore,
  writeDatabaseSnapshot
};