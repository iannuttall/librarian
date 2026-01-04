import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "puppeteer-core";

export interface HeadlessConfig {
  enabled?: boolean;
  chromePath?: string;
  proxy?: string; // IP-whitelisted proxy (no auth), e.g. http://p.webshare.io:9999
  timeout?: number;
  noSandbox?: boolean;
}

export interface HeadlessRenderer {
  isEnabled(): boolean;
  isAvailable(): boolean;
  findChromeBinary(): string | null;
  getChromeVersion(): string | null;
  render(url: string, userAgent?: string): Promise<string | null>;
  close(): Promise<void>;
}

const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/usr/local/bin/chrome",
    "/usr/local/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
  ],
};

const CHROME_NAMES: Record<string, string[]> = {
  darwin: ["Google Chrome", "Chromium", "chrome", "chromium"],
  linux: ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome"],
  win32: ["chrome.exe", "chromium.exe"],
};

export function findChromeBinaryPath(configuredPath?: string): string | null {
  // Use configured path if valid
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  const platform = process.platform;
  const candidates = CHROME_CANDIDATES[platform] ?? [];

  // Check known locations
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Try to find in PATH
  const names = CHROME_NAMES[platform] ?? [];
  const pathSeparator = platform === "win32" ? ";" : ":";
  const pathDirs = (process.env.PATH ?? "").split(pathSeparator);

  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = `${dir}/${name}`;
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export function getChromeVersion(chromePath: string): string | null {
  try {
    // On macOS, invoking the Chrome binary can open UI windows; read the app bundle plist instead.
    if (process.platform === "darwin") {
      const appIdx = chromePath.indexOf(".app/");
      if (appIdx !== -1) {
        const appPath = chromePath.slice(0, appIdx + 4);
        const plistPath = join(appPath, "Contents", "Info.plist");

        const versionFromPlist = execFileSync(
          "plutil",
          ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plistPath],
          { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
        ).trim();

        const plistMatch = versionFromPlist.match(/(\d+(?:\.\d+)+)/);
        if (plistMatch?.[1]) return plistMatch[1];
      }
    }

    const tmpProfile = mkdtempSync(join(tmpdir(), "librarian-chrome-version-"));
    try {
      // Try --product-version first (cleaner output)
      const output = execFileSync(
        chromePath,
        [
          "--product-version",
          "--headless=new",
          `--user-data-dir=${tmpProfile}`,
          "--no-first-run",
          "--no-default-browser-check",
        ],
        { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      ).trim();

      if (/^\d+\.\d+\.\d+\.\d+$/.test(output)) {
        return output;
      }

      // Fallback to --version
      const versionOutput = execFileSync(
        chromePath,
        [
          "--version",
          "--headless=new",
          `--user-data-dir=${tmpProfile}`,
          "--no-first-run",
          "--no-default-browser-check",
        ],
        { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
      );

      const match = versionOutput.match(/(\d+\.\d+\.\d+\.\d+)/);
      return match?.[1] ?? null;
    } finally {
      try {
        rmSync(tmpProfile, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch {
    return null;
  }
}

export async function createHeadlessRenderer(config: HeadlessConfig = {}): Promise<HeadlessRenderer | null> {
  const enabled = config.enabled ?? true;
  const chromePath = findChromeBinaryPath(config.chromePath);
  const proxy = config.proxy;
  const timeout = config.timeout ?? 30000;
  const noSandbox = config.noSandbox ?? true;

  if (!enabled || !chromePath) {
    return null;
  }

  let browser: Browser | null = null;
  let userDataDir: string | null = null;

  const ensureBrowser = async (): Promise<Browser> => {
    if (browser) return browser;

    // Dynamic import to avoid loading puppeteer if not needed
    const puppeteer = await import("puppeteer-core");

    const args = [
      // Redundantly force headless so Chrome never shows UI windows even if Puppeteer config is ignored.
      "--headless=new",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-backgrounding-occluded-windows",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--hide-scrollbars",
      "--mute-audio",
      "--metrics-recording-only",
      "--password-store=basic",
    ];

    if (process.platform === "darwin") {
      args.push("--use-mock-keychain");
    }

    if (noSandbox) {
      args.push("--no-sandbox", "--disable-setuid-sandbox");
    }

    if (proxy) {
      args.push(`--proxy-server=${proxy}`);
    }

    // Force an isolated profile so we never attach to the user's running Chrome (which can open tabs/windows).
    userDataDir = mkdtempSync(join(tmpdir(), "librarian-chrome-"));
    args.push(`--user-data-dir=${userDataDir}`);

    browser = await puppeteer.default.launch({
      executablePath: chromePath,
      // Use Chromium's "new" headless mode explicitly to avoid macOS UI windows stealing focus.
      headless: "new",
      args,
      defaultViewport: { width: 1920, height: 1080 },
      timeout,
      pipe: true, // Use pipe instead of WebSocket to avoid some issues
    });

    return browser;
  };

  return {
    isEnabled: () => enabled,
    isAvailable: () => chromePath !== null,
    findChromeBinary: () => chromePath,
    getChromeVersion: () => (chromePath ? getChromeVersion(chromePath) : null),

    async render(url: string, userAgent?: string): Promise<string | null> {
      try {
        const b = await ensureBrowser();
        const page = await b.newPage();

        if (userAgent) {
          await page.setUserAgent(userAgent);
        }

        // Disable images for faster loading
        await page.setRequestInterception(true);
        page.on("request", (req) => {
          if (req.resourceType() === "image") {
            req.abort();
          } else {
            req.continue();
          }
        });

        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout,
        });

        // Best-effort: don't block on networkidle0 (CSR sites can keep long-lived connections).
        try {
          await page.waitForNetworkIdle({
            idleTime: 500,
            timeout: Math.min(timeout, 10000),
          });
        } catch {
          // ignore
        }

        // Wait for JS frameworks to render
        await new Promise((r) => setTimeout(r, 2000));

        const html = await page.content();
        await page.close();

        return html;
      } catch (err) {
        console.error("HeadlessRenderer error:", err);
        return null;
      }
    },

    async close(): Promise<void> {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // Ignore close errors
        }
        browser = null;
      }

      if (userDataDir) {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
        userDataDir = null;
      }
    },
  };
}

export function getInstallInstructions(): string {
  const platform = process.platform;

  if (platform === "darwin") {
    return `Install Chrome:
  - Download from https://www.google.com/chrome/
  - Or: brew install --cask google-chrome`;
  }

  if (platform === "linux") {
    return `Install Chrome:
  - Debian/Ubuntu: sudo apt install google-chrome-stable
  - Or: sudo apt install chromium-browser
  - Or: sudo snap install chromium`;
  }

  if (platform === "win32") {
    return `Install Chrome:
  - Download from https://www.google.com/chrome/
  - Or: winget install Google.Chrome`;
  }

  return "Install Google Chrome from https://www.google.com/chrome/";
}
