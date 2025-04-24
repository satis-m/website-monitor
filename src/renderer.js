const websitesTableBody = document.getElementById('websites-table').querySelector('tbody');
const websiteUrlInput = document.getElementById('website-url');
const addButton = document.getElementById('add-button');
const messageArea = document.getElementById('message-area');

function displayMessage(text, type = 'info') {
	messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
	setTimeout(() => {
		messageArea.innerHTML = '';
	}, 5000);
}

// UPDATED: Handles null/undefined/NaN timestamps gracefully
function formatTimestamp(timestamp) {
	if (!timestamp) return 'N/A';
	if (isNaN(timestamp)) return 'Invalid Date'; // Check if it's a number
	try {
		return new Date(timestamp).toLocaleString();
	} catch (e) {
		console.error("Error formatting timestamp:", timestamp, e);
		return 'Invalid Date';
	}
}

// UPDATED: Includes logic for Downtime Started column
function renderWebsites(websites) {
	websitesTableBody.innerHTML = ''; // Clear existing rows

	if (!websites || websites.length === 0) {
		// Update colspan to match header
		websitesTableBody.innerHTML = '<tr><td colspan="5">No websites added yet.</td></tr>';
		return;
	}

	websites.forEach(site => {
		const row = websitesTableBody.insertRow();

		// Determine value for Downtime Started column
		// Show only if status is DOWN and the timestamp exists
		const showDowntimeStart = site.status === 'DOWN' && site.last_down_timestamp;
		const downtimeStartFormatted = showDowntimeStart ? formatTimestamp(site.last_down_timestamp) : 'N/A';

		// Update row content to include the new cell
		row.innerHTML = `
            <td>${site.url}</td>
            <td class="status-${site.status ? site.status.toLowerCase() : 'unknown'}">${site.status || 'UNKNOWN'}</td>
            <td>${downtimeStartFormatted}</td> <!-- ADDED Cell for Downtime Started -->
            <td>${formatTimestamp(site.last_checked)}</td>
            <td>
                <button class="delete-btn" data-id="${site.id}">Delete</button>
            </td>
        `;
	});
}

async function loadWebsites() {
	try {
		console.log("Requesting websites from main process..."); // Keep console logs for browser debugging
		const websites = await window.electronAPI.getWebsites();
		console.log("Received websites:", websites);
		renderWebsites(websites);
	} catch (error) {
		console.error('Error loading websites:', error);
		displayMessage(`Error loading websites: ${error.message}`, 'error');
		// Update colspan in error message
		websitesTableBody.innerHTML = '<tr><td colspan="5">Error loading websites.</td></tr>';
	}
}

async function handleAddWebsite() {
	const url = websiteUrlInput.value.trim();
	if (!url) {
		displayMessage('Please enter a website URL.', 'error');
		return;
	}

	addButton.disabled = true;
	addButton.textContent = 'Adding...';

	try {
		const result = await window.electronAPI.addWebsite(url);
		if (result.success) {
			displayMessage(`Website "${url}" added successfully.`, 'success');
			websiteUrlInput.value = ''; // Clear input
			// loadWebsites(); // Let the 'websites-updated' signal handle refresh
		} else {
			displayMessage(`Error adding website: ${result.message || 'Unknown error'}`, 'error');
		}
	} catch (error) {
		console.error('Error adding website:', error);
		displayMessage(`Error adding website: ${error.message}`, 'error');
	} finally {
		addButton.disabled = false;
		addButton.textContent = 'Add Website';
	}
}

async function handleDeleteWebsite(event) {
	if (event.target.classList.contains('delete-btn')) {
		const button = event.target;
		const id = button.getAttribute('data-id');
		const row = button.closest('tr');
		const url = row ? row.cells[0].textContent : `ID ${id}`; // Get URL or use ID

		if (confirm(`Are you sure you want to delete "${url}"?`)) {
			button.disabled = true;
			button.textContent = 'Deleting...';
			try {
				const result = await window.electronAPI.deleteWebsite(id);
				if (result.success) {
					displayMessage(`Website "${url}" deleted successfully.`, 'success');
					// loadWebsites(); // Let the 'websites-updated' signal handle refresh
				} else {
					displayMessage(`Error deleting website: ${result.message || 'Unknown error'}`, 'error');
					button.disabled = false;
					button.textContent = 'Delete';
				}
			} catch (error) {
				console.error('Error deleting website:', error);
				displayMessage(`Error deleting website: ${error.message}`, 'error');
				button.disabled = false;
				button.textContent = 'Delete';
			}
		}
	}
}

// --- Event Listeners ---
addButton.addEventListener('click', handleAddWebsite);
websitesTableBody.addEventListener('click', handleDeleteWebsite);

// Listen for updates pushed from the main process
window.electronAPI.onWebsitesUpdated(() => {
	console.log("Received websites-updated event from main process. Reloading list.");
	loadWebsites(); // Reload data when notified
});


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadWebsites);