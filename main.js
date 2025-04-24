// --- IMPORTS ---
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');

// --- CONFIGURE LOGGING (VERY EARLY) ---
log.transports.console.level = process.env.NODE_ENV === 'production' ? false : 'info';
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');
log.transports.file.level = 'info';
Object.assign(console, log.functions);
log.info('------------------------------------');
log.info('App starting...');
log.info(`App version: ${app.getVersion()}`);
log.info(`Electron version: ${process.versions.electron}`);
log.info(`Node version: ${process.versions.node}`);
log.info(`Platform: ${process.platform}`);
log.info(`User data path: ${app.getPath('userData')}`);
log.info(`Log file: ${log.transports.file.getFile().path}`);
log.info('------------------------------------');

// --- CATCH UNHANDLED ERRORS ---
log.catchErrors({
	showDialog: false,
	onError(error, versions, submitIssue) {
		log.error('Unhandled Error/Rejection Caught:', error);
		dialog.showErrorBox(
			'Unhandled Application Error',
			`An unexpected error occurred. Please report this issue.\n\nError:\n${error.stack || error}\n\nLogs are available at:\n${log.transports.file.getFile().path}`
		);
		isQuitting = true;
		app.quit();
	}
});

// --- MODULE IMPORTS (AFTER LOGGING SETUP) ---
const db = require('./src/database');
const monitor = require('./src/monitor');

// --- GLOBAL VARIABLES ---
let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;
global.mainWindow = mainWindow; // Update this reference when mainWindow is assigned
const isDev = process.env.NODE_ENV !== 'production';
const appName = app.getName(); // Get app name for tooltips/messages

// --- TRAY CREATION ---
function createTray() {
	log.info('Attempting to create system tray icon.');
	const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
	const iconPath = path.join(__dirname, 'assets', iconName);

	if (!fs.existsSync(iconPath)) {
		log.error(`Tray icon not found at path: ${iconPath}. Cannot create tray.`);
		dialog.showErrorBox('Tray Icon Error', `Icon file not found: ${iconPath}\nApplication will run without a system tray icon.`);
		return;
	}

	try {
		const nImage = nativeImage.createFromPath(iconPath);
		if (nImage.isEmpty()) {
			log.error(`Failed to create nativeImage from path: ${iconPath}.`);
			dialog.showErrorBox('Tray Icon Error', `Could not load icon file: ${iconPath}\nApplication will run without a system tray icon.`);
			return;
		}

		tray = new Tray(nImage);
		tray.setToolTip(appName); // Use dynamic app name

		tray.on('click', () => { log.info('Tray icon clicked.'); toggleWindowVisibility(); });
		tray.on('double-click', () => { log.info('Tray icon double-clicked.'); toggleWindowVisibility(); });

		updateTrayContextMenu(); // Initial setup
		log.info('System tray icon created successfully.');

	} catch (error) {
		log.error('Failed to create system tray icon:', error);
		dialog.showErrorBox('Tray Creation Error', `Could not create the system tray icon.\n\n${error.message}`);
	}
}

// --- UPDATE TRAY CONTEXT MENU ---
function updateTrayContextMenu() {
	if (!tray || tray.isDestroyed()) { log.warn('Attempted to update context menu, but tray is null or destroyed.'); return; }
	try {
		const isWindowVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
		const contextMenu = Menu.buildFromTemplate([
			{ label: isWindowVisible ? 'Hide Window' : 'Show Window', click: () => { toggleWindowVisibility(); } },
			{ type: 'separator' },
			{ label: `Quit ${appName}`, click: () => { log.info('Quit requested from tray menu.'); isQuitting = true; app.quit(); } }
		]);
		tray.setContextMenu(contextMenu);
	} catch (error) { log.error('Error updating tray context menu:', error); }
}

// --- TOGGLE WINDOW VISIBILITY ---
function toggleWindowVisibility() {
	if (!mainWindow || mainWindow.isDestroyed()) { log.warn('Toggle visibility called, but mainWindow is null or destroyed. Recreating.'); createWindow(); return; }
	if (mainWindow.isVisible()) { log.info('Hiding main window from toggle.'); mainWindow.hide(); }
	else { log.info('Showing main window from toggle.'); if (mainWindow.isMinimized()) { mainWindow.restore(); } mainWindow.show(); mainWindow.focus(); }
}

// --- CREATE MAIN WINDOW ---
function createWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) { log.warn("createWindow called, but window already exists. Focusing it."); mainWindow.focus(); return; }
	try {
		log.info('Creating main window...');
		mainWindow = new BrowserWindow({
			width: 850, // Slightly wider for new column
			height: 600,
			show: true,
			webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
			skipTaskbar: false,
			icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
		});
		global.mainWindow = mainWindow; // Update global reference HERE

		mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

		if (isDev) { log.info('Opening DevTools.'); mainWindow.webContents.openDevTools(); }

		mainWindow.on('close', (event) => {
			log.info(`Main window 'close' event triggered. Is quitting: ${isQuitting}`);
			if (!isQuitting) {
				event.preventDefault(); mainWindow.hide(); log.info('Close intercepted. Window hidden.');
				if (tray && !tray.isDestroyed()) {
					tray.displayBalloon({ iconType: 'info', title: appName, content: 'Application is still running in the system tray.' });
				}
			} else { log.info('Close allowed because isQuitting is true.'); }
		});

		mainWindow.on('show', () => { log.info("Main window 'show' event."); mainWindow.setSkipTaskbar(false); updateTrayContextMenu(); });
		mainWindow.on('hide', () => { log.info("Main window 'hide' event."); mainWindow.setSkipTaskbar(true); updateTrayContextMenu(); });
		mainWindow.on('closed', () => { log.info('Main window closed (destroyed).'); mainWindow = null; global.mainWindow = null; });

		log.info('Main window created successfully.');

	} catch (error) {
		log.error('FATAL: Failed to create main window:', error);
		dialog.showErrorBox('Window Creation Error', `Could not create the main application window.\n\n${error.message}`);
		isQuitting = true; app.quit();
	}
}

// --- CREATE SETTINGS WINDOW ---
function openSettingsWindow() {
	// (Keep the existing settings window logic - no changes needed here)
	if (settingsWindow) { settingsWindow.focus(); return; }
	log.info('Opening settings window...');
	settingsWindow = new BrowserWindow({
		width: 500, height: 450, parent: mainWindow, modal: true, show: false,
		webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
		icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
	});
	settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
	settingsWindow.setMenuBarVisibility(false);
	settingsWindow.once('ready-to-show', () => { settingsWindow.show(); log.info('Settings window shown.'); });
	settingsWindow.on('closed', () => { log.info('Settings window closed.'); settingsWindow = null; });
}

// --- APPLICATION MENU ---
function setupMenu() {
	// (Keep the existing menu setup logic - no changes needed here)
	const menuTemplate = [
		{ label: 'File', submenu: [{ label: 'Settings', click: () => openSettingsWindow() }, { type: 'separator' }, { label: 'Exit', click: () => { log.info('Exit requested from File menu.'); isQuitting = true; app.quit(); } }] },
		{ label: 'Window', submenu: [{ label: 'Show Application', click: () => { toggleWindowVisibility(); } }, { role: 'minimize' }, { label: 'Hide Window', click: () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.close(); } } }] },
		{ label: 'Help', submenu: [{ label: 'View Logs', click: () => { log.info("Opening log file location..."); shell.showItemInFolder(log.transports.file.getFile().path); } }, ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] : [])] }
	];
	const menu = Menu.buildFromTemplate(menuTemplate);
	Menu.setApplicationMenu(menu);
	log.info('Application menu setup.');
}

// --- APP LIFECYCLE ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { log.warn('Another instance is already running. Quitting this instance.'); app.quit(); }
else {
	app.on('second-instance', (event, commandLine, workingDirectory) => {
		log.info('Second instance detected. Focusing/Showing main window.');
		if (mainWindow) {
			if (mainWindow.isDestroyed()) { createWindow(); }
			else { if (!mainWindow.isVisible()) { mainWindow.show(); } if (mainWindow.isMinimized()) { mainWindow.restore(); } mainWindow.focus(); }
		} else { createWindow(); }
	});

	app.whenReady().then(async () => {
		log.info('App Ready event fired.');
		try {
			db.ensureDataDirExists(); log.info(`Database will be stored at: ${db.dbPath}`);
			await db.initDb(); log.info('Database initialized successfully.');
			setupMenu();
			createWindow(); // Create main window AFTER DB init
			createTray(); // Create tray AFTER window usually
			monitor.startMonitoring();

			app.on('activate', () => { // macOS dock click
				log.info('App activate event triggered.');
				if (BrowserWindow.getAllWindows().length === 0) { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); } else { createWindow(); } }
				else if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); }
			});

		} catch (error) {
			log.error('FATAL: Failed during app startup:', error);
			dialog.showErrorBox('Fatal Application Error', `The application could not start.\n\nError: ${error.message}\n\nLogs: ${log.transports.file.getFile().path}`);
			isQuitting = true; app.quit();
		}
	});
}

app.on('window-all-closed', () => {
	log.info('All windows closed event fired.');
	if (process.platform !== 'darwin') { if (!tray || tray.isDestroyed()) { log.warn('All windows closed and no valid tray icon found, quitting.'); isQuitting = true; app.quit(); } else { log.info('All windows closed, but tray exists. App remains active.'); } }
	else { log.info('macOS platform: App remains active after window closed.'); }
});

app.on('before-quit', async (event) => {
	log.info('Before Quit event triggered.');
	isQuitting = true;
	if (tray && !tray.isDestroyed()) { log.info('Destroying tray icon...'); tray.destroy(); } tray = null;
	monitor.stopMonitoring();
	try { await db.closeDb(); }
	catch (err) { log.error("Error during database closing in before-quit:", err); }
	log.info("Cleanup finished. Application will now exit.");
});

// --- IPC HANDLERS ---
// (These remain unchanged from the previous version - add logging as needed)

ipcMain.handle('get-settings', async () => {
	// log.info('IPC: get-settings invoked.'); // Uncomment for detailed IPC logging
	try {
		const email = await db.getSetting('adminEmail');
		const password = await db.getSetting('adminPassword');
		return { email: email || '', password: password || '' };
	} catch (error) {
		log.error('IPC Error get-settings:', error);
		throw error;
	}
});

ipcMain.handle('save-settings', async (event, settings) => {
	// Add logging to see received data and results
	log.info(`IPC: save-settings invoked. Received:`, settings); // Log the whole object
	if (!settings || typeof settings.email === 'undefined' || typeof settings.password === 'undefined') {
		log.error('IPC Error save-settings: Invalid settings object received.');
		return { success: false, message: 'Invalid data sent from renderer.' };
	}
	try {
		// Use Promise.all to save both settings concurrently
		await Promise.all([
			db.saveSetting('adminEmail', settings.email),
			db.saveSetting('adminPassword', settings.password) // SECURITY WARNING still applies
		]);
		log.info('IPC: save-settings - Settings successfully saved via db.saveSetting.');

		// Optional: Close settings window after saving
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			log.info('IPC: save-settings - Closing settings window.');
			settingsWindow.close();
		}
		return { success: true };
	} catch (error) {
		log.error('IPC Error save-settings during db operation:', error);
		// Return specific error message if available
		return { success: false, message: error.message || 'Failed to save settings to database.' };
	}
});

ipcMain.handle('get-websites', async () => {
	// log.info('IPC: get-websites invoked.'); // Uncomment for detailed IPC logging
	try {
		return await db.getAllWebsites();
	} catch (error) {
		log.error('IPC Error get-websites:', error);
		throw error;
	}
});

ipcMain.handle('add-website', async (event, url) => {
	log.info(`IPC: add-website invoked for URL: ${url}`);
	try {
		if (!url || !url.trim()) throw new Error("URL cannot be empty.");
		const trimmedUrl = url.trim();
		const id = await db.addWebsite(trimmedUrl);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('websites-updated'); // Notify UI
		return { success: true, id };
	} catch (error) {
		log.error('IPC Error add-website:', error);
		return { success: false, message: error.message };
	}
});

ipcMain.handle('delete-website', async (event, id) => {
	log.info(`IPC: delete-website invoked for ID: ${id}`);
	try {
		await db.deleteWebsite(id);
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('websites-updated'); // Notify UI
		return { success: true };
	} catch (error) {
		log.error('IPC Error delete-website:', error);
		return { success: false, message: error.message };
	}
});

ipcMain.handle('send-test-email', async (event, credentials) => {
	// Add logging to see received credentials and results
	log.info(`IPC: send-test-email invoked. Received email: ${credentials?.email}, Password provided: ${!!credentials?.password}`);
	if (!credentials || !credentials.email || !credentials.password) {
		log.warn('IPC: send-test-email - Missing email or password.');
		return { success: false, message: "Email and Password are required." };
	}
	try {
		log.info(`IPC: send-test-email - Calling monitor.sendTestEmail for ${credentials.email}...`);
		// Call the function imported from monitor.js
		const result = await monitor.sendTestEmail(credentials.email, credentials.password);
		log.info(`IPC: send-test-email - Result from monitor.sendTestEmail:`, result);
		return result; // Forward the result { success: boolean, message: string }
	} catch (error) {
		// Catch errors from monitor.sendTestEmail if it throws
		log.error('IPC Error send-test-email during monitor call:', error);
		return { success: false, message: error.message || "An unknown error occurred while sending." };
	}
});