// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

// LocalSheets ships as a single file opened via file://. No dev server needed.
const APP_URL = 'file://' + path.resolve(__dirname, '..', 'localsheets.html').replace(/\\/g, '/');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: APP_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Chromium accepts clipboard permissions; the other engines don't (and the
    // tests we have don't actually exercise the clipboard).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
});

module.exports.APP_URL = APP_URL;
