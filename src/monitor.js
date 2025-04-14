const axios = require('axios');
const nodemailer = require('nodemailer');
const db = require('./database');
const log = require('electron-log'); // Use electron-log

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
let monitorIntervalId = null;
let isMonitoringPaused = false; // To prevent overlapping runs

// --- Email Sending --- (No changes needed here)
async function sendNotificationEmail(subject, body) {
	log.info(`Attempting to send email: ${subject}`);
	try {
		const adminEmail = await db.getSetting('adminEmail');
		const adminPassword = await db.getSetting('adminPassword'); // **SECURITY WARNING**

		if (!adminEmail || !adminPassword) {
			log.warn('Admin email or password not configured. Cannot send notification.');
			return;
		}

		// SMTP Configuration (Keep your existing settings)
		const transporter = nodemailer.createTransport({
			host: 'smtp.example.com', // REPLACE with your SMTP host
			port: 587,
			secure: false,
			auth: {
				user: adminEmail,
				pass: adminPassword,
			},
			tls: {
				// rejectUnauthorized: false
			}
		});

		const mailOptions = {
			from: `"Website Monitor" <${adminEmail}>`,
			to: adminEmail,
			subject: subject,
			text: body,
		};

		let info = await transporter.sendMail(mailOptions);
		log.info("Notification email sent: %s", info.messageId);

	} catch (error) {
		log.error("Error sending notification email:", error);
	}
}

// --- Website Checking --- (No changes needed here)
async function checkWebsite(website) {
	const url = website.url;
	log.debug(`Checking ${url}...`); // Use debug for frequent messages
	let isUp = false;
	let errorMsg = null;
	let checkUrl = url;

	try {
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			checkUrl = 'http://' + url;
		}

		const response = await axios.get(checkUrl, {
			timeout: 10000,
			validateStatus: (status) => status >= 200 && status < 400,
			maxRedirects: 5,
		});
		isUp = true;
		log.debug(`${url} is UP (Status: ${response.status})`);

	} catch (error) {
		isUp = false;
		if (error.response) {
			errorMsg = `Status ${error.response.status}`;
		} else if (error.request) {
			errorMsg = `No response received`;
		} else {
			errorMsg = `Request setup error: ${error.message}`;
		}
		log.warn(`${url} appears DOWN (${errorMsg || 'Check failed'})`); // Use warn for actual issues
	}

	return { isUp, errorMsg };
}

// --- Monitoring Loop --- ( *** KEY CHANGES HERE *** )
async function monitorAllWebsites() {
	if (isMonitoringPaused) {
		log.debug("Monitoring is paused, skipping check cycle.");
		return;
	}

	log.info("--- Starting Monitor Cycle ---");
	isMonitoringPaused = true; // Pause to prevent overlap
	let databaseWasUpdated = false; // <-- Flag to track if *any* DB write occurred

	try {
		const websites = await db.getAllWebsites();
		if (!websites || websites.length === 0) {
			log.info("No websites configured to monitor.");
			// Ensure monitoring is unpaused even if no websites
			isMonitoringPaused = false;
			return;
		}

		// Use Promise.allSettled to check websites somewhat concurrently
		// and handle individual check failures gracefully.
		const checkPromises = websites.map(async (site) => {
			try {
				const { isUp, errorMsg } = await checkWebsite(site);
				const newStatus = isUp ? 'UP' : 'DOWN';
				const oldStatus = site.status;

				if (newStatus !== oldStatus) {
					log.info(`Status change for ${site.url}: ${oldStatus} -> ${newStatus}`);
					// Update DB first
					await db.updateWebsiteStatus(site.id, newStatus);
					databaseWasUpdated = true; // Mark that DB was written to

					// Send notifications only on transitions
					if (newStatus === 'DOWN' && oldStatus !== 'DOWN') {
						const subject = `ALERT: Website Down - ${site.url}`;
						const body = `The website ${site.url} appears to be DOWN.\nReason: ${errorMsg || 'Failed check'}\nTimestamp: ${new Date().toISOString()}`;
						await sendNotificationEmail(subject, body); // Intentionally awaited
					} else if (newStatus === 'UP' && oldStatus === 'DOWN') {
						const subject = `RESOLVED: Website Up - ${site.url}`;
						const body = `The website ${site.url} is back UP.\nTimestamp: ${new Date().toISOString()}`;
						await sendNotificationEmail(subject, body); // Intentionally awaited
					}
				} else {
					// Status is the same, just update the last checked time
					await db.updateWebsiteCheckTime(site.id);
					databaseWasUpdated = true; // Mark that DB was written to
					log.debug(`No status change for ${site.url} (Still ${newStatus}). Updated check time.`);
				}
			} catch (siteError) {
				log.error(`Error processing site ${site.url} (ID: ${site.id}) during check:`, siteError);
				// Continue processing other sites
			}
		});

		// Wait for all checks in the current batch to complete (or fail)
		await Promise.allSettled(checkPromises);
		log.info("All website checks for this cycle completed.");

	} catch (error) {
		// Error fetching websites list or other unexpected issue in the main try block
		log.error("Error during monitoring cycle setup or fetching websites:", error);
	} finally {
		// --- Send ONE UI update signal AFTER the whole loop ---
		if (databaseWasUpdated && global.mainWindow && !global.mainWindow.isDestroyed()) {
			log.info("Database was updated this cycle. Sending 'websites-updated' signal to renderer.");
			global.mainWindow.webContents.send('websites-updated');
		} else if (!databaseWasUpdated) {
			log.info("No website database updates in this cycle, no UI signal sent.");
		} else if (!global.mainWindow || global.mainWindow.isDestroyed()) {
			log.warn("Database was updated, but main window is not available to send signal.");
		}

		log.info("--- Finished Monitor Cycle ---");
		isMonitoringPaused = false; // Re-enable for next cycle regardless of outcome
	}
}

// --- Start/Stop Monitoring --- (No changes needed here)
function startMonitoring() {
	if (monitorIntervalId) {
		log.warn("startMonitoring called, but monitoring is already running.");
		return;
	}
	log.info(`Starting website monitoring loop. Interval: ${CHECK_INTERVAL_MS / 1000} seconds.`);
	// Run once immediately, then set interval
	monitorAllWebsites(); // Perform initial check
	monitorIntervalId = setInterval(monitorAllWebsites, CHECK_INTERVAL_MS);
}

function stopMonitoring() {
	if (monitorIntervalId) {
		log.info("Stopping website monitoring loop.");
		clearInterval(monitorIntervalId);
		monitorIntervalId = null;
	} else {
		log.info("stopMonitoring called, but monitoring was not running.");
	}
}

module.exports = {
	startMonitoring,
	stopMonitoring
	// No need to expose checkWebsite externally usually
};