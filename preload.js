const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	// Settings
	getSettings: () => ipcRenderer.invoke('get-settings'),
	saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

	// Websites
	getWebsites: () => ipcRenderer.invoke('get-websites'),
	addWebsite: (url) => ipcRenderer.invoke('add-website', url),
	deleteWebsite: (id) => ipcRenderer.invoke('delete-website', id),

	// Listen for updates from Main process
	onWebsitesUpdated: (callback) => ipcRenderer.on('websites-updated', callback)
});