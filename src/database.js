const { app } = require('electron'); // <-- Import app here
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const log = require('electron-log'); // <-- Use electron-log

// --- Determine the correct user data path ---
// This path is reliable in both development and packaged states.
// It points to a writable location specific to your app for the current user.
// Example: C:\Users\YourUser\AppData\Roaming\YourAppName
const userDataPath = app.getPath('userData');

// Store the database within a 'data' subfolder inside the userData path
const dbDir = path.join(userDataPath, 'data');
const dbPath = path.join(dbDir, 'monitor_db.sqlite');

let db;

// --- Function to Ensure Data Directory Exists ---
// This MUST be called from main.js *after* app is ready, *before* initDb
function ensureDataDirExists() {
	log.info(`Ensuring database directory exists at: ${dbDir}`);
	if (!fs.existsSync(dbDir)) {
		try {
			fs.mkdirSync(dbDir, { recursive: true }); // Ensure parent dirs are created too
			log.info(`Created database directory: ${dbDir}`);
		} catch (err) {
			log.error(`Fatal: Error creating database directory ${dbDir}:`, err);
			// Re-throw the error to be caught by the main process startup handler
			throw new Error(`Failed to create database directory: ${err.message}`);
		}
	} else {
		log.info(`Database directory already exists: ${dbDir}`);
	}
}

// --- Initialize Database ---
function initDb() {
	return new Promise((resolve, reject) => {
		// The check/creation of dbDir should happen *before* this in main.js
		log.info(`Attempting to connect/create DB at: ${dbPath}`);

		// Explicitly use flags to allow creation if it doesn't exist
		db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
			if (err) {
				log.error(`Error opening/creating database at ${dbPath}:`, err.message);
				return reject(err); // Reject the promise on error
			}
			log.info(`Successfully connected to the SQLite database: ${dbPath}`);

			// Create tables if they don't exist
			db.serialize(() => {
				// Use Promise.all to wait for both table creations
				Promise.all([
					new Promise((resolveTable, rejectTable) => {
						db.run(`CREATE TABLE IF NOT EXISTS settings (
                            key TEXT PRIMARY KEY,
                            value TEXT
                        )`, (errTable) => {
							if (errTable) {
								log.error("DB Error creating 'settings' table:", errTable);
								return rejectTable(errTable);
							}
							log.info("Checked/Created 'settings' table.");
							resolveTable();
						});
					}),
					new Promise((resolveTable, rejectTable) => {
						db.run(`CREATE TABLE IF NOT EXISTS websites (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            url TEXT NOT NULL UNIQUE,
                            status TEXT DEFAULT 'UNKNOWN', -- 'UP', 'DOWN', 'UNKNOWN'
                            last_checked INTEGER,
                            last_status_change INTEGER
                        )`, (errTable) => {
							if (errTable) {
								log.error("DB Error creating 'websites' table:", errTable);
								return rejectTable(errTable);
							}
							log.info("Checked/Created 'websites' table.");
							resolveTable();
						});
					})
				]).then(() => {
					log.info("Database tables checked/created successfully.");
					resolve(); // Resolve the main initDb promise
				}).catch(reject); // If any table creation fails, reject initDb
			});
		});
	});
}

// --- Settings ---
function getSetting(key) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
			if (err) {
				log.warn(`Error getting setting '${key}':`, err);
				return reject(err);
			}
			resolve(row ? row.value : null);
		});
	});
}

function saveSetting(key, value) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.run('REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], function (err) {
			if (err) {
				log.error(`Error saving setting '${key}':`, err);
				return reject(err);
			}
			log.info(`Setting saved: ${key}`);
			resolve();
		});
	});
}

// --- Websites --- (Assuming these functions remain largely the same, adding logging)
function getAllWebsites() {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.all('SELECT * FROM websites ORDER BY url', [], (err, rows) => {
			if (err) { log.error("Error getting all websites:", err); return reject(err); }
			resolve(rows);
		});
	});
}

function addWebsite(url) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const stmt = db.prepare('INSERT INTO websites (url, status, last_status_change) VALUES (?, ?, ?)');
		stmt.run([url, 'UNKNOWN', Date.now()], function (err) {
			stmt.finalize();
			if (err) {
				log.warn(`Error adding website '${url}':`, err.message); // Use warn for constraints
				if (err.code === 'SQLITE_CONSTRAINT') {
					return reject(new Error(`URL already exists: ${url}`));
				}
				return reject(err);
			}
			log.info(`Website added: ${url} (ID: ${this.lastID})`);
			resolve(this.lastID);
		});
	});
}

function deleteWebsite(id) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.run('DELETE FROM websites WHERE id = ?', [id], function (err) {
			if (err) { log.error(`Error deleting website ID ${id}:`, err); return reject(err); }
			if (this.changes === 0) { log.warn(`Attempted to delete non-existent website ID ${id}`); return reject(new Error(`Website with ID ${id} not found.`)); }
			log.info(`Website deleted: ID ${id}`);
			resolve();
		});
	});
}

function updateWebsiteStatus(id, status) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const now = Date.now();
		db.run('UPDATE websites SET status = ?, last_checked = ?, last_status_change = ? WHERE id = ?',
			[status, now, now, id],
			function (err) {
				if (err) { log.error(`Error updating status for website ID ${id}:`, err); return reject(err); }
				// log.info(`Website status updated: ID ${id} -> ${status}`); // Can be noisy, log elsewhere if needed
				resolve();
			});
	});
}

function updateWebsiteCheckTime(id) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const now = Date.now();
		db.run('UPDATE websites SET last_checked = ? WHERE id = ?',
			[now, id],
			function (err) {
				if (err) { log.error(`Error updating check time for website ID ${id}:`, err); return reject(err); }
				resolve();
			});
	});
}


function getWebsiteById(id) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.get('SELECT * FROM websites WHERE id = ?', [id], (err, row) => {
			if (err) { log.error(`Error getting website by ID ${id}:`, err); return reject(err); }
			resolve(row);
		});
	});
}


// --- Close Database ---
function closeDb() {
	return new Promise((resolve, reject) => {
		if (db) {
			log.info("Closing database connection...");
			db.close((err) => {
				if (err) {
					log.error('Error closing database:', err.message);
					return reject(err);
				}
				log.info('Database connection closed.');
				db = null; // Clear reference
				resolve();
			});
		} else {
			log.info('Database already closed or never opened.');
			resolve(); // Already closed or never opened
		}
	});
}

module.exports = {
	ensureDataDirExists, // <-- Export the new function
	initDb,
	closeDb,
	getSetting,
	saveSetting,
	getAllWebsites,
	addWebsite,
	deleteWebsite,
	updateWebsiteStatus,
	updateWebsiteCheckTime,
	getWebsiteById,
	dbPath // <-- Export dbPath for logging/debugging info
};