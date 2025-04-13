// --- IMPORTS ---
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, Tray, nativeImage } = require('electron'); // Added Tray, nativeImage
const path = require('path');
const fs = require('fs'); // Added fs for icon check
const log = require('electron-log'); // Use electron-log

// --- CONFIGURE LOGGING (VERY EARLY) ---
// Log to console in development and file in production
log.transports.console.level = process.env.NODE_ENV === 'production' ? false : 'info';
// Define log file path within the app's userData directory
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');
log.transports.file.level = 'info'; // Log 'info' level and above (error, warn, info)
Object.assign(console, log.functions); // Optional: Redirect console.log/warn/error to electron-log
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
	showDialog: false, // We will show our own dialog in the catch block below
	onError(error, versions, submitIssue) {
		log.error('Unhandled Error/Rejection Caught:', error);
		dialog.showErrorBox(
			'Unhandled Application Error',
			`An unexpected error occurred. Please report this issue.\n\nError:\n${error.stack || error}\n\nLogs are available at:\n${log.transports.file.getFile().path}`
		);
		// Ensure app quits on unhandled errors after showing message
		isQuitting = true; // Set flag to ensure cleanup runs
		app.quit();
	}
});


// --- MODULE IMPORTS (AFTER LOGGING SETUP) ---
const db = require('./src/database'); // db object now has ensureDataDirExists & dbPath
const monitor = require('./src/monitor');

// --- GLOBAL VARIABLES ---
let mainWindow = null;
let settingsWindow = null;
let tray = null; // Variable for the Tray instance
let isQuitting = false; // Flag to indicate real quitting vs hiding
global.mainWindow = mainWindow; // Make accessible globally (update ref when window created)
const isDev = process.env.NODE_ENV !== 'production';

// --- TRAY CREATION ---
function createTray() {
	log.info('Attempting to create system tray icon.');
	// Assuming 'assets' folder is at the project root alongside main.js
	const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'; // Use .ico on Windows if available
	const iconPath = path.join(__dirname, 'assets', iconName);

	// Verify icon exists before creating tray
	if (!fs.existsSync(iconPath)) {
		log.error(`Tray icon not found at path: ${iconPath}. Cannot create tray.`);
		dialog.showErrorBox('Tray Icon Error', `Icon file not found: ${iconPath}\nApplication will run without a system tray icon.`);
		return; // Stop tray creation
	}

	try {
		const nImage = nativeImage.createFromPath(iconPath);
		if (nImage.isEmpty()) {
			log.error(`Failed to create nativeImage from path: ${iconPath}. It might be corrupted or an unsupported format.`);
			dialog.showErrorBox('Tray Icon Error', `Could not load icon file: ${iconPath}\nApplication will run without a system tray icon.`);
			return;
		}

		tray = new Tray(nImage);

		// Set Tooltip
		tray.setToolTip('Website Monitor');

		// Handle Tray Clicks (Single click toggles visibility)
		tray.on('click', () => {
			log.info('Tray icon clicked.');
			toggleWindowVisibility();
		});

		// Optional: Double click can also toggle or do something else
		tray.on('double-click', () => {
			log.info('Tray icon double-clicked.');
			toggleWindowVisibility(); // Same action as single click for simplicity
		});

		// Set Context Menu (Initial setup)
		updateTrayContextMenu();

		log.info('System tray icon created successfully.');

	} catch (error) {
		log.error('Failed to create system tray icon:', error);
		dialog.showErrorBox('Tray Creation Error', `Could not create the system tray icon.\n\n${error.message}\n\nLogs: ${log.transports.file.getFile().path}`);
		// App can likely continue without a tray, but log the error
	}
}

// --- UPDATE TRAY CONTEXT MENU ---
// Call this to refresh the menu (e.g., after showing/hiding window)
function updateTrayContextMenu() {
	if (!tray || tray.isDestroyed()) { // Check if tray exists and is not destroyed
		log.warn('Attempted to update context menu, but tray is null or destroyed.');
		return;
	}
	try {
		const isWindowVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
		const contextMenu = Menu.buildFromTemplate([
			{
				label: isWindowVisible ? 'Hide Window' : 'Show Window',
				click: () => {
					toggleWindowVisibility();
				}
			},
			{ type: 'separator' },
			{
				label: 'Quit Website Monitor',
				click: () => {
					log.info('Quit requested from tray menu.');
					isQuitting = true; // Set flag to allow quitting
					app.quit();
				}
			}
		]);
		tray.setContextMenu(contextMenu);
		// log.debug('Tray context menu updated.'); // Use debug level for frequent updates
	} catch (error) {
		log.error('Error updating tray context menu:', error);
	}
}


// --- TOGGLE WINDOW VISIBILITY ---
function toggleWindowVisibility() {
	if (!mainWindow || mainWindow.isDestroyed()) { // Check if destroyed too
		log.warn('Toggle visibility called, but mainWindow is null or destroyed. Recreating.');
		// Recreate the window if it was somehow destroyed while the app was running
		createWindow();
		return; // createWindow will handle showing it
	}

	if (mainWindow.isVisible()) {
		log.info('Hiding main window from toggle.');
		mainWindow.hide();
	} else {
		log.info('Showing main window from toggle.');
		if (mainWindow.isMinimized()) { // If minimized, restore before showing
			mainWindow.restore();
		}
		mainWindow.show();
		mainWindow.focus(); // Bring it to the front
	}
	// updateTrayContextMenu(); // No need to call here, handled by show/hide events
}


// --- CREATE MAIN WINDOW ---
function createWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		log.warn("createWindow called, but window already exists. Focusing it.");
		mainWindow.focus();
		return;
	}

	try {
		log.info('Creating main window...');
		mainWindow = new BrowserWindow({
			width: 800,
			height: 600,
			show: true, // Show the window immediately on creation
			webPreferences: {
				preload: path.join(__dirname, 'preload.js'),
				contextIsolation: true,
				nodeIntegration: false,
			},
			skipTaskbar: false, // Start in taskbar
			icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png') // Set window icon
		});
		global.mainWindow = mainWindow; // Update global reference

		mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

		if (isDev) {
			log.info('Opening DevTools.');
			mainWindow.webContents.openDevTools();
		}

		// --- Intercept Close Event ---
		mainWindow.on('close', (event) => {
			log.info(`Main window 'close' event triggered. Is quitting: ${isQuitting}`);
			if (!isQuitting) {
				event.preventDefault(); // Prevent the window from closing
				mainWindow.hide();      // Hide it instead
				log.info('Close intercepted. Window hidden.');
				// Optional: Show a balloon notification only once or less frequently
				if (tray && !tray.isDestroyed()) {
					tray.displayBalloon({
						iconType: 'info',
						title: 'Website Monitor',
						content: 'Application is still running in the system tray.'
					});
				}
			} else {
				log.info('Close allowed because isQuitting is true.');
				// Allow the close event to proceed normally if we are actually quitting
			}
		});

		// Handle show/hide events for tray menu label and taskbar management
		mainWindow.on('show', () => {
			log.info("Main window 'show' event.");
			mainWindow.setSkipTaskbar(false); // Ensure it's back in taskbar when shown
			updateTrayContextMenu();
		});
		mainWindow.on('hide', () => {
			log.info("Main window 'hide' event.");
			mainWindow.setSkipTaskbar(true); // Remove from taskbar when hidden (on supported platforms)
			updateTrayContextMenu();
		});

		// Handle window being destroyed
		mainWindow.on('closed', () => {
			log.info('Main window closed (destroyed).');
			mainWindow = null;
			global.mainWindow = null;
			// Do not close settings window here if app continues in tray
			// Do not quit app here, rely on tray 'Quit' or explicit exit
		});

		log.info('Main window created successfully.');

	} catch (error) {
		log.error('FATAL: Failed to create main window:', error);
		dialog.showErrorBox('Window Creation Error', `Could not create the main application window.\n\n${error.message}\n\nLogs: ${log.transports.file.getFile().path}`);
		isQuitting = true; // Ensure quit happens cleanly
		app.quit();
	}
}

// --- CREATE SETTINGS WINDOW ---
function openSettingsWindow() {
	if (settingsWindow) {
		settingsWindow.focus();
		return;
	}
	log.info('Opening settings window...');
	settingsWindow = new BrowserWindow({
		width: 500,
		height: 450, // Adjusted height slightly
		parent: mainWindow, // Should still have a parent even if main is hidden
		modal: true,
		show: false, // Show when ready
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
		icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png') // Settings icon
	});

	settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
	settingsWindow.setMenuBarVisibility(false); // No menu for settings modal

	settingsWindow.once('ready-to-show', () => {
		settingsWindow.show();
		log.info('Settings window shown.');
	});

	settingsWindow.on('closed', () => {
		log.info('Settings window closed.');
		settingsWindow = null;
	});
}

// --- APPLICATION MENU ---
function setupMenu() {
	const menuTemplate = [
		{
			label: 'File',
			submenu: [
				{
					label: 'Settings',
					click: () => openSettingsWindow()
				},
				{ type: 'separator' },
				{
					label: 'Exit',
					click: () => {
						log.info('Exit requested from File menu.');
						isQuitting = true;
						app.quit();
					}
				}
			]
		},
		{
			label: 'Window',
			submenu: [
				{
					label: 'Show Application',
					click: () => {
						toggleWindowVisibility(); // Use toggle function for consistency
					}
				},
				{ role: 'minimize' },
				{ // Add a close option which will trigger hide logic
					label: 'Hide Window',
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.close(); // Triggers our 'close' event handler
						}
					}
				}
			]
		},
		{
			label: 'Help',
			submenu: [
				{
					label: 'View Logs',
					click: () => {
						log.info("Opening log file location...");
						shell.showItemInFolder(log.transports.file.getFile().path);
					}
				},
				...(isDev ? [
					{ type: 'separator' },
					{ role: 'reload' },
					{ role: 'forceReload' },
					{ role: 'toggleDevTools' }
				] : [])
			]
		}
	];
	const menu = Menu.buildFromTemplate(menuTemplate);
	Menu.setApplicationMenu(menu);
	log.info('Application menu setup.');
}

// --- APP LIFECYCLE ---

// Single Instance Lock - Prevents multiple copies of your app
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	log.warn('Another instance is already running. Quitting this instance.');
	app.quit();
} else {
	// Event handler for second instance attempts
	app.on('second-instance', (event, commandLine, workingDirectory) => {
		log.info('Second instance detected. Focusing/Showing main window.');
		// Someone tried to run a second instance, we should focus our window.
		if (mainWindow) {
			if (mainWindow.isDestroyed()) {
				createWindow(); // Recreate if destroyed
			} else {
				if (!mainWindow.isVisible()) {
					mainWindow.show(); // Show if hidden
				}
				if (mainWindow.isMinimized()) {
					mainWindow.restore(); // Restore if minimized
				}
				mainWindow.focus(); // Bring to front
			}
		} else {
			// If main window is null (shouldn't happen if app is running), recreate it
			createWindow();
		}
	});

	// --- APP READY --- (Main startup logic)
	app.whenReady().then(async () => {
		log.info('App Ready event fired.');
		try {
			// 1. Ensure the data directory exists *before* initializing the database
			db.ensureDataDirExists(); // Call the exported function
			log.info(`Database will be stored at: ${db.dbPath}`);

			// 2. Initialize the database connection
			await db.initDb();
			log.info('Database initialized successfully.');

			// 3. Setup application menu
			setupMenu();

			// 4. Create the main application window
			createWindow(); // Creates the initial window

			// 5. Create the System Tray Icon <<< --- ADDED
			createTray();

			// 6. Start the background monitoring service
			monitor.startMonitoring();

			// Handle activation (e.g., clicking dock icon on macOS)
			app.on('activate', () => {
				log.info('App activate event triggered.');
				// On macOS it's common to re-create a window if none are open
				if (BrowserWindow.getAllWindows().length === 0) {
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.show();
					} else {
						createWindow();
					}
				} else if (mainWindow && !mainWindow.isDestroyed()) {
					// Ensure window is shown if activate is triggered while hidden
					mainWindow.show();
				}
			});

		} catch (error) {
			// --- CRITICAL STARTUP FAILURE ---
			log.error('FATAL: Failed during app startup (ensureDataDirExists or initDb):', error);
			dialog.showErrorBox(
				'Fatal Application Error',
				`The application could not start due to an error initializing data storage.\n\nPlease check permissions for the application's data folder or contact support.\n\nError: ${error.message}\n\nLogs are available at:\n${log.transports.file.getFile().path}`
			);
			isQuitting = true; // Ensure clean quit
			app.quit(); // Quit if DB setup fails
		}
	});
} // End of if(gotTheLock) block


// --- Window All Closed Handler ---
// This event is less critical for quitting now, as the app lives in the tray.
app.on('window-all-closed', () => {
	log.info('All windows closed event fired.');
	// On macOS, apps usually stay active.
	// On Windows/Linux with a tray icon, we *don't* want to quit here.
	if (process.platform !== 'darwin') {
		// If the tray icon *failed* to create or was destroyed unexpectedly,
		// then closing the last window should quit the app.
		if (!tray || tray.isDestroyed()) {
			log.warn('All windows closed and no valid tray icon found, quitting.');
			isQuitting = true; // Ensure cleanup runs correctly
			app.quit();
		} else {
			log.info('All windows closed, but tray exists. App remains active.');
		}
	} else {
		log.info('macOS platform: App remains active after window closed.');
		// Optional: Nullify the main menu when no windows are open on macOS
		// Menu.setApplicationMenu(null);
	}
});


// --- Before Quit Handler --- (Triggered by app.quit())
app.on('before-quit', async (event) => {
	log.info('Before Quit event triggered.');
	isQuitting = true; // Explicitly ensure flag is set

	// 1. Destroy Tray Icon
	if (tray && !tray.isDestroyed()) {
		log.info('Destroying tray icon...');
		tray.destroy();
	}
	tray = null;

	// 2. Stop Monitoring Service
	monitor.stopMonitoring(); // Should already log its status

	// 3. Close Database Connection
	try {
		await db.closeDb(); // Should already log its status
	} catch (err) {
		// Error logged within closeDb, maybe add context here
		log.error("Error during database closing in before-quit:", err);
	}

	log.info("Cleanup finished. Application will now exit.");
	// No preventDefault needed, allow the quit process to complete.
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
	log.info('IPC: save-settings invoked.');
	try {
		await db.saveSetting('adminEmail', settings.email);
		await db.saveSetting('adminPassword', settings.password); // SECURITY WARNING still applies
		log.info('Settings saved via IPC.');
		if (settingsWindow && !settingsWindow.isDestroyed()) {
			settingsWindow.close(); // Close settings window after saving
		}
		return { success: true };
	} catch (error) {
		log.error('IPC Error save-settings:', error);
		return { success: false, message: error.message };
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