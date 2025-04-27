const axios = require('axios');
const nodemailer = require('nodemailer');
const db = require('./database');
const log = require('electron-log'); // Use electron-log

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const NETWORK_CHECK_TIMEOUT_MS = 5000; // 5 seconds for connectivity check
const NETWORK_CHECK_URL = 'http://connectivitycheck.gstatic.com/generate_204'; // Google's lightweight check URL

let monitorIntervalId = null;
let isMonitoringPaused = false;


// *** NEW FUNCTION: Check Internet Connectivity ***
async function isNetworkAvailable() {
	log.debug(`Checking network connectivity via HEAD request to ${NETWORK_CHECK_URL}`);
	try {
		// Use HEAD request for minimal data transfer
		await axios.head(NETWORK_CHECK_URL, { timeout: NETWORK_CHECK_TIMEOUT_MS });
		log.info("Network connectivity check successful.");
		return true; // Request succeeded, network is likely available
	} catch (error) {
		// Log specific errors if available, otherwise generic message
		const errorCode = error.code || 'Unknown';
		const errorMessage = error.message || 'No error message';
		log.warn(`Network connectivity check failed. Code: ${errorCode}, Message: ${errorMessage}`);
		if (error.code === 'ENOTFOUND') {
			log.warn("-> Suggests DNS resolution issue or no network connection.");
		} else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
			log.warn("-> Suggests connection timed out, possibly slow or blocked network.");
		} else if (error.code === 'ECONNREFUSED') {
			log.warn("-> Suggests connection refused by the server (less likely for Google).");
		}
		return false; // Request failed, network is likely unavailable
	}
}

// --- Email Sending ---
async function sendNotificationEmail(subject, body) {
	log.info(`Attempting to send email: ${subject}`); // Keep this primary log
	try {
		const adminEmail = await db.getSetting('adminEmail');
		const adminPassword = await db.getSetting('adminPassword');

		if (!adminEmail || !adminPassword) {
			log.warn('Admin email or password not configured. Cannot send notification.');
			return;
		}

		// *** IMPORTANT: CONFIGURE YOUR SMTP DETAILS HERE ***
		const transporter = nodemailer.createTransport({
			host: 'smtp.gmail.com', // e.g., 'smtp.gmail.com' or 'smtp.office365.com'
			port: 587,                // Common port for STARTTLS
			secure: false,            // true for 465 (SSL), false for 587 (STARTTLS)
			auth: {
				user: adminEmail,
				pass: adminPassword, // Use App Password if possible!
			},
			tls: {
				// Use if your provider uses self-signed certs (less common, less secure)
				// rejectUnauthorized: false
			}
		});
		// **************************************************

		const mailOptions = {
			from: `"Website Monitor" <${adminEmail}>`,
			to: adminEmail, // Sends to the configured admin email
			subject: subject,
			text: body,
		};

		// Verify connection configuration (optional but recommended for debug)
		// await transporter.verify();
		// log.info("SMTP Server connection verified.");

		let info = await transporter.sendMail(mailOptions);
		log.info("Notification email sent successfully: %s", info.messageId);

	} catch (error) {
		log.error("Error sending notification email:", error); // Log the detailed error
		// Consider adding user feedback if email fails persistently
	}
}

// *** NEW FUNCTION: Send Test Email ***
async function sendTestEmail(testEmail, testPassword) {
	log.info(`Attempting to send TEST email to: ${testEmail}`);
	if (!testEmail || !testPassword) {
		log.error("Test email failed: Email or Password missing.");
		throw new Error("Email address and Password are required to send a test email.");
	}

	try {
		// *** IMPORTANT: Use the SAME SMTP CONFIGURATION as sendNotificationEmail ***
		// Consider refactoring this config into a shared function/object if it gets complex
		const transporter = nodemailer.createTransport({
			host: 'smtp.gmail.com', // e.g., 'smtp.gmail.com' or 'smtp.office365.com'
			port: 587,                // Common port for STARTTLS
			secure: false,            // true for 465 (SSL), false for 587 (STARTTLS)
			auth: {
				user: testEmail,      // Use the provided test email
				pass: testPassword,   // Use the provided test password (App Password!)
			},
			tls: {
				// rejectUnauthorized: false
			}
		});
		// ************************************************************************

		const mailOptions = {
			from: `"Website Monitor Test" <${testEmail}>`, // Sender address (using test email)
			to: testEmail, // Send the test email TO the admin email itself
			subject: "Website Monitor - Test Email", // Subject line
			text: "This is a test email from the Website Monitor application.\n\nIf you received this, your email settings appear to be configured correctly.", // plain text body
		};

		// Optional: Verify connection before sending (good for immediate feedback)
		// await transporter.verify();
		// log.info("SMTP Connection verified for test email.");

		let info = await transporter.sendMail(mailOptions);
		log.info("Test email sent successfully: %s", info.messageId);
		return { success: true, message: `Test email sent successfully to ${testEmail}.` };

	} catch (error) {
		log.error("Error sending test email:", error);
		// Provide a more helpful error message if possible
		let errorMessage = error.message;
		if (error.code === 'EAUTH') {
			errorMessage = "Authentication failed. Check email/password (use App Password if applicable).";
		} else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
			errorMessage = "Connection failed. Check SMTP host/port and firewall settings.";
		}
		throw new Error(`Failed to send test email: ${errorMessage}`); // Re-throw cleaned error
	}
}

// --- Website Checking ---
async function checkWebsite(website) {
	const url = website.url;
	log.debug(`Checking ${url}...`);
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
			headers: { // Add a basic user-agent
				'User-Agent': 'WebsiteMonitorElectronApp/1.0'
			}
		});
		isUp = true;
		log.debug(`${url} is UP (Status: ${response.status})`);

	} catch (error) {
		isUp = false;
		if (error.response) {
			errorMsg = `Status ${error.response.status}`;
		} else if (error.request) {
			errorMsg = `No response received (Timeout or network issue)`;
		} else {
			errorMsg = `Request setup error: ${error.message}`;
		}
		log.warn(`${url} appears DOWN (${errorMsg || 'Check failed'})`);
	}

	return { isUp, errorMsg };
}

// --- Monitoring Loop ---
async function monitorAllWebsites() {
	if (isMonitoringPaused) {
		log.debug("Monitoring is paused, skipping check cycle.");
		return;
	}

	log.info("--- Starting Monitor Cycle ---");
	isMonitoringPaused = true;


	// *** PERFORM INTERNET CONNECTIVITY CHECK FIRST ***
	const networkUp = await isNetworkAvailable();
	if (!networkUp) {
		log.warn("Network connection check failed. Skipping website monitoring for this cycle.");
		isMonitoringPaused = false; // Unpause to allow next cycle attempt
		log.info("--- Finished Monitor Cycle (Skipped due to network unavailability) ---");
		return; // Exit the function early
	}
	// *** END OF INTERNET CHECK ***

	let databaseWasUpdated = false; // Track if any DB write occurred

	try {
		const websites = await db.getAllWebsites();
		if (!websites || websites.length === 0) {
			log.info("No websites configured to monitor.");
			// isMonitoringPaused = false;
			// return;
		} else {

			const checkPromises = websites.map(async (site) => {
				try {
					const { isUp, errorMsg } = await checkWebsite(site);
					const newStatus = isUp ? 'UP' : 'DOWN';
					const oldStatus = site.status;

					if (newStatus !== oldStatus) {
						log.info(`Status change for ${site.url}: ${oldStatus} -> ${newStatus}`);
						databaseWasUpdated = true;

						if (newStatus === 'DOWN') {
							await db.recordWebsiteDown(site.id); // Use new function
							if (oldStatus !== 'DOWN') { // Only notify on transition into DOWN
								log.info(`--> Calling sendNotificationEmail for DOWN event: ${site.url}`); // Confirm call
								const subject = `ALERT: Website Down - ${site.url}`;
								const body = `The website ${site.url} appears to be DOWN.\nReason: ${errorMsg || 'Failed check'}\nTimestamp: ${new Date().toISOString()}`;
								await sendNotificationEmail(subject, body); // Intentionally await
							}
						} else { // newStatus must be 'UP'
							await db.recordWebsiteUp(site.id); // Use new function
							if (oldStatus === 'DOWN') { // Only notify on transition out of DOWN
								log.info(`--> Calling sendNotificationEmail for UP event: ${site.url}`); // Confirm call
								const subject = `RESOLVED: Website Up - ${site.url}`;
								const body = `The website ${site.url} is back UP.\nTimestamp: ${new Date().toISOString()}`;
								await sendNotificationEmail(subject, body); // Intentionally await
							}
						}
					} else {
						// Status is the same, just update the last checked time
						await db.updateWebsiteCheckTime(site.id);
						databaseWasUpdated = true;
						log.debug(`No status change for ${site.url} (Still ${newStatus}). Updated check time.`);
					}
				} catch (siteError) {
					log.error(`Error processing site ${site.url} (ID: ${site.id}) during check:`, siteError);
				}
			});

			await Promise.allSettled(checkPromises);
			log.info("All website checks for this cycle completed.");
		}


	} catch (error) {
		log.error("Error during monitoring cycle setup or fetching websites:", error);
	} finally {
		// Send ONE UI update signal AFTER the whole loop IF DB was updated
		if (databaseWasUpdated && global.mainWindow && !global.mainWindow.isDestroyed()) {
			log.info("Database was updated this cycle. Sending 'websites-updated' signal to renderer.");
			global.mainWindow.webContents.send('websites-updated');
		} else if (!databaseWasUpdated) {
			log.info("No website database updates in this cycle, no UI signal sent.");
		} else if (!global.mainWindow || global.mainWindow.isDestroyed()) {
			log.warn("Database was updated, but main window is not available to send signal.");
		}

		log.info("--- Finished Monitor Cycle ---");
		isMonitoringPaused = false; // Re-enable for next cycle
	}
}

// --- Start/Stop Monitoring ---
function startMonitoring() {
	if (monitorIntervalId) {
		log.warn("startMonitoring called, but monitoring is already running.");
		return;
	}
	log.info(`Starting website monitoring loop. Interval: ${CHECK_INTERVAL_MS / 1000} seconds.`);
	monitorAllWebsites(); // Run once immediately
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
	stopMonitoring,
	sendTestEmail
};