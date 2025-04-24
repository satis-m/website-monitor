const { app } = require('electron'); // <-- Import app here
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const log = require('electron-log'); // <-- Use electron-log

// Determine the correct user data path
const userDataPath = app.getPath('userData');
const dbDir = path.join(userDataPath, 'data');
const dbPath = path.join(dbDir, 'monitor_db.sqlite');

let db;

// Function to Ensure Data Directory Exists
function ensureDataDirExists() {
	log.info(`Ensuring database directory exists at: ${dbDir}`);
	if (!fs.existsSync(dbDir)) {
		try {
			fs.mkdirSync(dbDir, { recursive: true });
			log.info(`Created database directory: ${dbDir}`);
		} catch (err) {
			log.error(`Fatal: Error creating database directory ${dbDir}:`, err);
			throw new Error(`Failed to create database directory: ${err.message}`);
		}
	} else {
		log.info(`Database directory already exists: ${dbDir}`);
	}
}

// Initialize Database
function initDb() {
	return new Promise((resolve, reject) => {
		log.info(`Attempting to connect/create DB at: ${dbPath}`);
		db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
			if (err) {
				log.error(`Error opening/creating database at ${dbPath}:`, err.message);
				return reject(err);
			}
			log.info(`Successfully connected to the SQLite database: ${dbPath}`);

			db.serialize(() => {
				Promise.all([
					new Promise((resolveTable, rejectTable) => {
						db.run(`CREATE TABLE IF NOT EXISTS settings (
                            key TEXT PRIMARY KEY,
                            value TEXT
                        )`, (errTable) => {
							if (errTable) { log.error("DB Error creating 'settings' table:", errTable); return rejectTable(errTable); }
							log.info("Checked/Created 'settings' table.");
							resolveTable();
						});
					}),
					new Promise((resolveTable, rejectTable) => {
						// --- ADDED last_down_timestamp column ---
						db.run(`CREATE TABLE IF NOT EXISTS websites (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            url TEXT NOT NULL UNIQUE,
                            status TEXT DEFAULT 'UNKNOWN',
                            last_checked INTEGER,
                            last_status_change INTEGER,
                            last_down_timestamp INTEGER DEFAULT NULL  -- <-- ADDED
                        )`, (errTable) => {
							if (errTable) { log.error("DB Error creating 'websites' table:", errTable); return rejectTable(errTable); }
							log.info("Checked/Created 'websites' table.");
							resolveTable();
						});
					})
				]).then(() => {
					log.info("Database tables checked/created successfully.");
					resolve();
				}).catch(reject);
			});
		});
	});
}

// --- Settings ---
function getSetting(key) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
			if (err) { log.warn(`Error getting setting '${key}':`, err); return reject(err); }
			resolve(row ? row.value : null);
		});
	});
}

function saveSetting(key, value) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		db.run('REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], function (err) {
			if (err) { log.error(`Error saving setting '${key}':`, err); return reject(err); }
			log.info(`Setting saved: ${key}`);
			resolve();
		});
	});
}

// --- Websites ---

// ADDED: Call this ONLY when transitioning TO 'DOWN' state
function recordWebsiteDown(id) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const now = Date.now();
		// Update status, checked time, status change time, AND last down time
		db.run('UPDATE websites SET status = ?, last_checked = ?, last_status_change = ?, last_down_timestamp = ? WHERE id = ?',
			['DOWN', now, now, now, id], // Set last_down_timestamp to now
			function (err) {
				if (err) { log.error(`Error recording DOWN status for website ID ${id}:`, err); return reject(err); }
				log.info(`Website status recorded as DOWN: ID ${id}`);
				resolve();
			});
	});
}

// ADDED: Call this ONLY when transitioning FROM 'DOWN' TO 'UP' state
function recordWebsiteUp(id) {
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const now = Date.now();
		// Update status, checked time, status change time. DO NOT touch last_down_timestamp here.
		db.run('UPDATE websites SET status = ?, last_checked = ?, last_status_change = ? WHERE id = ?',
			['UP', now, now, id],
			function (err) {
				if (err) { log.error(`Error recording UP status for website ID ${id}:`, err); return reject(err); }
				log.info(`Website status recorded as UP: ID ${id}`);
				resolve();
			});
	});
}

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
	// Add website with default NULL for last_down_timestamp
	return new Promise((resolve, reject) => {
		if (!db) return reject(new Error("Database not initialized"));
		const stmt = db.prepare('INSERT INTO websites (url, status, last_status_change, last_down_timestamp) VALUES (?, ?, ?, ?)');
		stmt.run([url, 'UNKNOWN', Date.now(), null], function (err) {
			stmt.finalize();
			if (err) {
				log.warn(`Error adding website '${url}':`, err.message);
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

// Only updates check time when status hasn't changed
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

// --- Close Database ---
function closeDb() {
	return new Promise((resolve, reject) => {
		if (db) {
			log.info("Closing database connection...");
			db.close((err) => {
				if (err) { log.error('Error closing database:', err.message); return reject(err); }
				log.info('Database connection closed.');
				db = null;
				resolve();
			});
		} else {
			log.info('Database already closed or never opened.');
			resolve();
		}
	});
}

module.exports = {
	ensureDataDirExists,
	initDb,
	closeDb,
	getSetting,
	saveSetting,
	getAllWebsites,
	addWebsite,
	deleteWebsite,
	updateWebsiteCheckTime, // Keep this
	recordWebsiteDown,      // Export new
	recordWebsiteUp,        // Export new
	dbPath
};