const emailInput = document.getElementById('admin-email');
const passwordInput = document.getElementById('admin-password');
const saveButton = document.getElementById('save-settings-button');
const messageArea = document.getElementById('settings-message-area');

function displayMessage(text, type = 'info') {
	messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
	// Optional: Clear message after a few seconds
	setTimeout(() => {
		messageArea.innerHTML = '';
	}, 5000);
}

async function loadSettings() {
	try {
		const settings = await window.electronAPI.getSettings();
		emailInput.value = settings.email || '';
		passwordInput.value = settings.password || ''; // **SECURITY WARNING**
	} catch (error) {
		console.error('Error loading settings:', error);
		displayMessage(`Error loading settings: ${error.message}`, 'error');
	}
}

async function handleSaveSettings() {
	const settings = {
		email: emailInput.value.trim(),
		password: passwordInput.value // Don't trim password
	};

	// Basic validation
	if (!settings.email) {
		displayMessage('Admin Email cannot be empty.', 'error');
		return;
	}
	// Add more robust email validation if needed

	saveButton.disabled = true;
	saveButton.textContent = 'Saving...';

	try {
		const result = await window.electronAPI.saveSettings(settings);
		if (result.success) {
			displayMessage('Settings saved successfully!', 'success');
			// Window might be closed automatically by main process on success
		} else {
			displayMessage(`Error saving settings: ${result.message || 'Unknown error'}`, 'error');
			saveButton.disabled = false;
			saveButton.textContent = 'Save Settings';
		}

	} catch (error) {
		console.error('Error saving settings:', error);
		displayMessage(`Error saving settings: ${error.message}`, 'error');
		saveButton.disabled = false;
		saveButton.textContent = 'Save Settings';
	}
	// Note: The main process might close this window upon successful save (see main.js)
}

// --- Event Listeners ---
saveButton.addEventListener('click', handleSaveSettings);

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadSettings);