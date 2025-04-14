# Website Monitor Electron App

A simple desktop application for Windows built with Electron that monitors the uptime of specified websites. It runs in the system tray, checks URLs periodically, and sends email notifications to a configured administrator when a site goes down and again when it comes back up.

![App Screenshot](placeholder.png) <!-- TODO: Replace placeholder.png with an actual screenshot of your app -->

## Features

-   **Add & Manage Websites:** Easily add or remove website URLs to monitor via the main interface.
-   **Periodic Uptime Checks:** Automatically checks the status of each configured website every 1 minute.
-   **Email Notifications:** Sends an email alert when a monitored site becomes unreachable.
-   **Recovery Notifications:** Sends a follow-up email notification _only_ when a previously down site becomes reachable again.
-   **Admin Configuration:** Set the administrator email address and password (or App Password) for sending notifications via a dedicated Settings screen.
-   **System Tray Integration:**
    -   Runs conveniently in the Windows system tray.
    -   Closing the main window hides it to the tray instead of quitting.
    -   Tray icon provides options to Show/Hide the window or Quit the application.
-   **Persistent Storage:** Uses an SQLite database to store website lists and settings reliably.
-   **File Logging:** Logs application activity and errors to a file for easier troubleshooting.

## Technology Stack

-   **Electron:** Framework for building cross-platform desktop apps with web technologies.
-   **Node.js:** JavaScript runtime environment.
-   **SQLite3:** File-based relational database.
-   **axios:** Promise-based HTTP client for checking websites.
-   **nodemailer:** Module for sending emails.
-   **electron-log:** Simple logging library for Electron apps.
-   **electron-builder:** Tool for packaging and building the application.
-   **HTML, CSS, JavaScript:** For the user interface (Renderer Process).

## Prerequisites

Before you begin, ensure you have the following installed:

-   [Node.js](https://nodejs.org/) (LTS version recommended)
-   npm (Comes bundled with Node.js)
-   Git (for cloning the repository)

## Installation & Setup (Development)

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/website-monitor-app.git # Replace with your repo URL
    cd website-monitor-app
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Running the App (Development)

To run the application in development mode with live reloading and DevTools enabled:

```bash
npm start
Use code with caution.
Markdown
Building for Production
To package the application into a distributable Windows installer (.exe):

Set NODE_ENV (Important): Ensure the build process runs with NODE_ENV=production to disable DevTools in the final build. This is typically handled by adding cross-env to your build script.

Install cross-env: npm install --save-dev cross-env

Modify package.json (if not already done):

"scripts": {
  "start": "electron .",
  "package": "cross-env NODE_ENV=production electron-builder"
}
Use code with caution.
Json
Run the package command:

npm run package
Use code with caution.
Bash
Output: Find the installer in the dist directory.

Note for Windows Builds: If you encounter permission errors related to symbolic links during the build (A required privilege is not held by the client), try either:

Running the npm run package command in a terminal opened as Administrator.

Enabling Developer Mode in Windows Settings (Settings -> Update & Security / Privacy & security -> For developers).

Usage
Launch the Application: Run the installed .exe or use npm start for development.

Configure Email Settings:

Go to File -> Settings.

Enter the Admin Email address that will send the notifications (e.g., your monitoring email account).

Enter the corresponding Password.

SECURITY: For services like Gmail/GSuite, DO NOT use your main account password. Generate and use an App Password. See the Security Warning below.

Important: You must also configure the correct SMTP Host and Port directly in the src/monitor.js file within the nodemailer.createTransport options. Common examples:

Gmail: host: 'smtp.gmail.com', port: 587, secure: false (requires App Password & possibly enabling STARTTLS)

Outlook: host: 'smtp.office365.com', port: 587, secure: false

Click Save Settings.

Add Websites:

In the main application window, enter the full URL (e.g., https://example.com or example.com) into the input field.

Click Add Website. The site will appear in the table below.

Monitoring: The application automatically checks all listed websites every minute in the background. The Status and Last Checked columns will update.

System Tray:

Clicking the 'X' (close button) on the main window will hide it to the system tray. The app continues running.

Left-click the tray icon to show/hide the main window.

Right-click the tray icon for a context menu with options to Show/Hide the window or Quit the application entirely.

Quitting: To fully close the application, either:

Right-click the tray icon and select "Quit Website Monitor".

Select File -> Exit from the main window's menu.

Configuration Details
Email SMTP Settings: Hardcoded in src/monitor.js within nodemailer.createTransport. Modify the host, port, and secure options according to your email provider's requirements.

Check Interval: Hardcoded in src/monitor.js (variable CHECK_INTERVAL_MS). Default is 60000ms (1 minute).

Database Location: The monitor_db.sqlite file is stored in a data subfolder within the application's user data directory. You can find this path via Help -> View Logs (the log file is in a sibling logs folder).

Windows Example: C:\Users\YourUsername\AppData\Roaming\YourAppName\data\monitor_db.sqlite (Note: YourAppName is based on your package.json name or build.productName)

Troubleshooting & Logging
Logs: The application logs activity to a file. Access it via Help -> View Logs in the app menu, or find it manually at:

Windows: C:\Users\YourUsername\AppData\Roaming\YourAppName\logs\main.log

DevTools Opening in Production: If the Developer Tools open after building/installing, ensure NODE_ENV=production is set during the build process (see Building section).

Build Errors (Permissions): See the "Note for Windows Builds" under the Building section.

Emails Not Sending:

Double-check SMTP settings in src/monitor.js.

Verify admin email and password/App Password in Settings are correct.

Check email provider's security settings (e.g., enable "less secure apps" - not recommended, use App Passwords instead, or ensure correct ports/security protocols like STARTTLS are used).

Check application logs for errors from nodemailer.

⚠️ Security Warning
This application currently stores the configured admin email password directly in the SQLite database file located in the user's AppData directory.

This is insecure. Anyone with access to the user's computer could potentially access this file and retrieve the password in plain text.

Recommendation:

Use App Passwords: For services like Gmail, Outlook, etc., generate a dedicated "App Password" specifically for this application instead of using your main account password.

Future Improvement: Implement more secure storage methods like using electron-store with encryption or leveraging OS-level credential managers (e.g., Windows Credential Manager), which is more complex.

Do not use your primary email account password directly if possible.
```
