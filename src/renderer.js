const websitesTableBody = document.getElementById('websites-table').querySelector('tbody');
const websiteUrlInput = document.getElementById('website-url');
const addButton = document.getElementById('add-button');
const messageArea = document.getElementById('message-area');

function displayMessage(text, type = 'info') {
	messageArea.innerHTML = `<div class="message ${type}">${text}</div>`;
	// Optional: Clear message after a few seconds
	setTimeout(() => {
		messageArea.innerHTML = '';
	}, 5000);
}

function formatTimestamp(timestamp) {
	if (!timestamp) return 'N/A';
	try {
		return new Date(timestamp).toLocaleString();
	} catch (e) {
		return 'Invalid Date';
	}
}

function renderWebsites(websites) {
	websitesTableBody.innerHTML = ''; // Clear existing rows

	if (!websites || websites.length === 0) {
		websitesTableBody.innerHTML = '<tr><td colspan="4">No websites added yet.</td></tr>';
		return;
	}

	websites.forEach(site => {
		const row = websitesTableBody.insertRow();
		row.innerHTML = `
            <td>${site.url}</td>
            <td class="status-${site.status ? site.status.toLowerCase() : 'unknown'}">${site.status || 'UNKNOWN'}</td>
            <td>${formatTimestamp(site.last_checked)}</td>
            <td>
                <button class="delete-btn" data-id="${site.id}">Delete</button>
            </td>
        `;
	});
}

async function loadWebsites() {
	try {
		console.log("Requesting websites from main process...");
		const websites = await window.electronAPI.getWebsites();
		console.log("Received websites:", websites);
		renderWebsites(websites);
	} catch (error) {
		console.error('Error loading websites:', error);
		displayMessage(`Error loading websites: ${error.message}`, 'error');
		websitesTableBody.innerHTML = '<tr><td colspan="4">Error loading websites.</td></tr>';
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
			// No need to call loadWebsites() here, as the 'websites-updated' event will trigger it
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
		const url = row.cells[0].textContent; // Get URL for confirmation

		if (confirm(`Are you sure you want to delete "${url}" (ID: ${id})?`)) {
			button.disabled = true;
			button.textContent = 'Deleting...';
			try {
				const result = await window.electronAPI.deleteWebsite(id);
				if (result.success) {
					displayMessage(`Website "${url}" deleted successfully.`, 'success');
					// No need to call loadWebsites() here, as the 'websites-updated' event will trigger it
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

// Listen for updates pushed from the main process (e.g., after monitoring checks change status)
window.electronAPI.onWebsitesUpdated(() => {
	console.log("Received websites-updated event from main process. Reloading list.");
	loadWebsites();
});


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', loadWebsites);