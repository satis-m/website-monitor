const axios = require('axios');
const nodemailer = require('nodemailer');
const db = require('./database');

const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
let monitorIntervalId = null;
let isMonitoringPaused = false; // To prevent overlapping runs

// --- Email Sending ---
async function sendNotificationEmail(subject, body) {
	console.log(`Attempting to send email: ${subject}`);
	try {
		const adminEmail = await db.getSetting('adminEmail');
		const adminPassword = await db.getSetting('adminPassword'); // **SECURITY WARNING**

		if (!adminEmail || !adminPassword) {
			console.warn('Admin email or password not configured. Cannot send notification.');
			return;
		}

		// **SECURITY WARNING:** Storing passwords directly is insecure.
		// For Gmail/GSuite, use "App Passwords".
		// For other services, check their recommendations (OAuth2 is best).
		// This example uses basic SMTP auth, which might require enabling "less secure apps"
		// on some providers (like Gmail, which is phasing this out).
		const transporter = nodemailer.createTransport({
			host: 'smtp.gmail.com', // REPLACE with your SMTP host (e.g., smtp.gmail.com)
			port: 587, // Or 465 for SSL
			secure: false, // true for 465, false for other ports (like 587 with STARTTLS)
			auth: {
				user: adminEmail,
				pass: adminPassword,
			},
			tls: {
				// Do not fail on invalid certs (useful for some local testing, but less secure)
				// rejectUnauthorized: false
			}
		});

		const mailOptions = {
			from: `"Website Monitor" <${adminEmail}>`, // sender address
			to: adminEmail, // list of receivers
			subject: subject, // Subject line
			text: body, // plain text body
			// html: "<b>Hello world?</b>", // html body (optional)
		};

		let info = await transporter.sendMail(mailOptions);
		console.log("Message sent: %s", info.messageId);

	} catch (error) {
		console.error("Error sending notification email:", error);
		// Consider notifying the user in the app UI that email failed
	}
}

// --- Website Checking ---
async function checkWebsite(website) {
	const url = website.url;
	console.log(`Checking ${url}...`);
	let isUp = false;
	let errorMsg = null;

	try {
		// Add http:// if missing (basic check)
		let checkUrl = url;
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			checkUrl = 'http://' + url;
			console.log(`Prepended http:// to ${url}`);
		}

		const response = await axios.get(checkUrl, {
			timeout: 10000, // 10 second timeout
			validateStatus: function (status) {
				// Consider any 2xx or 3xx status as "UP"
				return status >= 200 && status < 400;
			},
			// Prevent redirects from being followed automatically if needed
			maxRedirects: 5,
		});
		isUp = true; // If request succeeds without throwing error
		console.log(`${url} is UP (Status: ${response.status})`);

	} catch (error) {
		isUp = false;
		if (error.response) {
			// The request was made and the server responded with a status code
			// that falls outside the range of 2xx/3xx
			errorMsg = `Status ${error.response.status}`;
			console.warn(`${url} is DOWN (${errorMsg})`);
		} else if (error.request) {
			// The request was made but no response was received
			errorMsg = `No response received`;
			console.warn(`${url} is DOWN (${errorMsg})`);
		} else {
			// Something happened in setting up the request that triggered an Error
			errorMsg = `Request setup error: ${error.message}`;
			console.warn(`${url} is DOWN (${errorMsg})`);
		}
	}

	return { isUp, errorMsg };
}

// --- Monitoring Loop ---
async function monitorAllWebsites() {
	if (isMonitoringPaused) {
		console.log("Monitoring is paused, skipping check cycle.");
		return;
	}

	console.log("\n--- Starting Monitor Cycle ---");
	isMonitoringPaused = true; // Pause to prevent overlap

	try {
		const websites = await db.getAllWebsites();
		if (!websites || websites.length === 0) {
			console.log("No websites configured to monitor.");
			return;
		}

		for (const site of websites) {
			const { isUp, errorMsg } = await checkWebsite(site);
			const newStatus = isUp ? 'UP' : 'DOWN';
			const oldStatus = site.status;

			if (newStatus !== oldStatus) {
				console.log(`Status change for ${site.url}: ${oldStatus} -> ${newStatus}`);
				await db.updateWebsiteStatus(site.id, newStatus); // Update DB first

				if (newStatus === 'DOWN') {
					// Send DOWN notification only when transitioning from UP/UNKNOWN to DOWN
					if (oldStatus !== 'DOWN') {
						const subject = `ALERT: Website Down - ${site.url}`;
						const body = `The website ${site.url} appears to be DOWN.\nReason: ${errorMsg || 'Failed check'}\nTimestamp: ${new Date().toISOString()}`;
						await sendNotificationEmail(subject, body);
					}
				} else if (newStatus === 'UP') {
					// Send UP notification only when transitioning from DOWN to UP
					if (oldStatus === 'DOWN') {
						const subject = `RESOLVED: Website Up - ${site.url}`;
						const body = `The website ${site.url} is back UP.\nTimestamp: ${new Date().toISOString()}`;
						await sendNotificationEmail(subject, body);
					}
				}
				// Trigger UI update after status change
				if (global.mainWindow) {
					global.mainWindow.webContents.send('websites-updated');
				}

			} else {
				// Update last checked time even if status didn't change
				await db.updateWebsiteCheckTime(site.id);
				console.log(`No status change for ${site.url} (Still ${newStatus}).`);
			}
		}

	} catch (error) {
		console.error("Error during monitoring cycle:", error);
	} finally {
		console.log("--- Finished Monitor Cycle ---\n");
		isMonitoringPaused = false; // Re-enable for next cycle
	}
}

function startMonitoring() {
	if (monitorIntervalId) {
		console.log("Monitoring already running.");
		return;
	}
	console.log(`Starting website monitoring loop every ${CHECK_INTERVAL_MS / 1000} seconds.`);
	// Run once immediately, then set interval
	monitorAllWebsites();
	monitorIntervalId = setInterval(monitorAllWebsites, CHECK_INTERVAL_MS);
}

function stopMonitoring() {
	if (monitorIntervalId) {
		console.log("Stopping website monitoring loop.");
		clearInterval(monitorIntervalId);
		monitorIntervalId = null;
	}
}

module.exports = {
	startMonitoring,
	stopMonitoring,
	checkWebsite // Expose for potential manual checks if needed
};