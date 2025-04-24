// src/settings_renderer.js

const emailInput = document.getElementById('admin-email');
const passwordInput = document.getElementById('admin-password');
const saveButton = document.getElementById('save-settings-button');
const testButton = document.getElementById('test-email-button');
const messageArea = document.getElementById('settings-message-area');

// Enhanced display message function
function displayMessage(text, type = 'info', clearPrevious = true) {
	if (clearPrevious) {
		messageArea.innerHTML = ''; // Clear previous messages
	}
	const messageDiv = document.createElement('div');
	messageDiv.className = `message ${type}`;
	messageDiv.textContent = text;
	messageArea.appendChild(messageDiv);
	console.log(`UI Message (${type}): ${text}`); // Log message to renderer console too

	// Auto-clear non-error messages after a delay
	if (type !== 'error') {
		setTimeout(() => {
			try { // Add try-catch in case element removed manually
				if (messageArea.contains(messageDiv)) {
					messageArea.removeChild(messageDiv);
				}
			} catch (e) { /* ignore */ }
		}, 7000); // Longer timeout
	}
}

// Load settings function
async function loadSettings() {
	console.log("Requesting settings from main process...");
	try {
		const settings = await window.electronAPI.getSettings();
		console.log("Received settings:", settings); // Log received settings
		emailInput.value = settings.email || '';
		passwordInput.value = settings.password || ''; // SECURITY WARNING
		displayMessage("Settings loaded.", "info", true);
	} catch (error) {
		console.error('Error loading settings:', error);
		displayMessage(`Error loading settings: ${error.message}`, 'error', true);
	}
}

// Save settings handler
async function handleSaveSettings() {
	const settingsToSave = {
		email: emailInput.value.trim(),
		password: passwordInput.value // Don't trim password
	};
	console.log("Attempting to save settings:", settingsToSave); // Log data being sent

	if (!settingsToSave.email) {
		displayMessage('Admin Email cannot be empty.', 'error', true);
		return;
	}
	// Basic password check (optional, remove if saving empty password is valid)
	if (!settingsToSave.password) {
		displayMessage('Password cannot be empty.', 'error', true);
		return;
	}


	saveButton.disabled = true;
	saveButton.textContent = 'Saving...';
	testButton.disabled = true;
	displayMessage("Saving settings...", "info", true);

	try {
		const result = await window.electronAPI.saveSettings(settingsToSave);
		console.log("Save settings result from main process:", result); // Log result

		if (result && result.success) {
			// Display success message, but don't clear it immediately
			// The main process might close the window.
			displayMessage('Settings saved successfully!', 'success', true);
			// If the window doesn't close automatically, re-enable buttons after a delay
			setTimeout(() => {
				saveButton.disabled = false;
				saveButton.textContent = 'Save Settings';
				testButton.disabled = false;
			}, 1500); // Short delay before re-enabling if window stays open
		} else {
			displayMessage(`Error saving settings: ${result?.message || 'Unknown error'}`, 'error', true);
			saveButton.disabled = false; // Re-enable only on failure
			testButton.disabled = false;
		}
	} catch (error) {
		console.error('Error invoking saveSettings:', error);
		displayMessage(`Error saving settings: ${error.message}`, 'error', true);
		saveButton.disabled = false; // Re-enable on error
		testButton.disabled = false;
	}
	// Note: Main process might close this window automatically on success
}


// Send Test Email handler
async function handleSendTestEmail() {
	const emailToSend = emailInput.value.trim();
	const passwordToSend = passwordInput.value;
	console.log(`Attempting to send test email. Email: ${emailToSend}, Password provided: ${passwordToSend ? 'Yes' : 'No'}`); // Log data being sent

	if (!emailToSend) { displayMessage('Please enter an Admin Email first.', 'error', true); return; }
	if (!passwordToSend) { displayMessage('Please enter the Password/App Password first.', 'error', true); return; }

	testButton.disabled = true;
	testButton.textContent = 'Sending...';
	saveButton.disabled = true;
	displayMessage('Sending test email...', 'info', true);

	try {
		const credentials = { email: emailToSend, password: passwordToSend };
		const result = await window.electronAPI.sendTestEmail(credentials);
		console.log("Send test email result from main process:", result); // Log result

		if (result && result.success) {
			// Display success message, but append, don't clear previous 'sending' message
			displayMessage(result.message, 'success', false);
		} else {
			// Display error message, but append, don't clear previous 'sending' message
			displayMessage(`Test Failed: ${result?.message || 'Unknown error'}`, 'error', false);
		}
	} catch (error) {
		console.error('Error invoking sendTestEmail:', error);
		displayMessage(`Error sending test email: ${error.message}`, 'error', false);
	} finally {
		// Re-enable buttons after attempt
		testButton.disabled = false;
		testButton.textContent = 'Send Test Email';
		saveButton.disabled = false;
	}
}

// --- Event Listeners ---
saveButton.addEventListener('click', handleSaveSettings);
testButton.addEventListener('click', handleSendTestEmail);

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadSettings);