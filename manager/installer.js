// manager/installer.js — Game Patcher, Script Installer & Auto-Updater Module
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile, execFileSync } = require('child_process');
const os = require('os');
const https = require('https');

const LOADER_PACKAGE = {
    name: 'aetheria-launcher',
    productName: 'Aetheria Online',
    version: '1.0.7',
    description: 'Aetheria Online for Windows + PmheeAether Auto-Injector',
    main: 'main.js',
    private: true
};

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const ROOT_DIR = path.resolve(__dirname, '..');
const BOT_SRC = path.join(ROOT_DIR, 'bot.js');
// manager/game_loader/main.js is a copy of the root main.js that the Manager self-update keeps current
// (release installs only receive manager/ files); fall back to the root file
const LOADER_SRC = fs.existsSync(path.join(__dirname, 'game_loader', 'main.js'))
    ? path.join(__dirname, 'game_loader', 'main.js')
    : path.join(ROOT_DIR, 'main.js');

function loadSettings() {
    let s = {};
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
        }
    } catch (e) {
        console.warn('[Installer] Failed to read settings.json:', e.message);
    }
    return {
        ...s,
        launchMode: s.launchMode || 'browser',
        browserKind: s.browserKind || 'chrome'
    };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[Installer] Failed to save settings.json:', e.message);
        return false;
    }
}

const GAME_EXE = 'Aetheria Online.exe';
const hasGameExe = dir => { try { return !!dir && fs.existsSync(path.join(dir, GAME_EXE)); } catch (e) { return false; } };

// Install folder from the game's uninstall entry (per-user or all-users install), looked up once
let registryGamePath;
function findGameInRegistry() {
    if (registryGamePath !== undefined) return registryGamePath;
    registryGamePath = null;
    try {
        const keys = [
            'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
            'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
        ].map(k => `'${k}'`).join(',');
        const ps = `Get-ItemProperty ${keys} -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Aetheria Online*' } | ForEach-Object { $_.InstallLocation; $_.DisplayIcon }`;
        const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 8000, windowsHide: true });
        for (const line of out.split(/\r?\n/)) {
            let p = line.trim().replace(/"/g, '').replace(/,\s*\d+$/, '');
            if (!p) continue;
            if (/\.exe$/i.test(p)) p = path.dirname(p);
            if (hasGameExe(p)) { registryGamePath = p; break; }
        }
    } catch (e) {}
    return registryGamePath;
}

// Where the game is installed on this PC: per-user (LocalAppData\Programs) or all-users (Program Files)
function getDefaultGamePath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
    const perUser = path.join(localAppData, 'Programs', 'Aetheria Online');
    const candidates = [
        perUser,
        path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'Aetheria Online'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Aetheria Online'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Aetheria Online')
    ];
    return candidates.find(hasGameExe) || findGameInRegistry() || perUser;
}

function getEffectiveGamePath(overridePath) {
    if (overridePath && typeof overridePath === 'string' && overridePath.trim()) {
        return overridePath.trim();
    }
    const settings = loadSettings();
    // A saved path from another PC (e.g. settings.json shipped in a zip) must not win over the real install
    if (settings.gamePath && typeof settings.gamePath === 'string' && hasGameExe(settings.gamePath.trim())) {
        return settings.gamePath.trim();
    }
    return getDefaultGamePath();
}

function getFileHash(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const buffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(buffer).digest('hex');
    } catch (e) {
        return null;
    }
}

function hasProtectedLoaderCapability(loaderPath) {
    try {const source=fs.readFileSync(loaderPath,'utf8');return /const LOADER_PROTOCOL = 1;/.test(source)&&source.includes('--pmhee-protected-script');}catch(_){return false;}
}
function checkStatus(overridePath) {
    const gamePath = getEffectiveGamePath(overridePath);
    const exePath = path.join(gamePath, 'Aetheria Online.exe');
    const resourcesPath = path.join(gamePath, 'resources');
    const appDir = path.join(resourcesPath, 'app');
    const loaderPath = path.join(appDir, 'main.js');
    const installedBotPath = path.join(resourcesPath, 'bot.js');
    const originalAsar = path.join(resourcesPath, 'app.asar.original');
    const disabledAsar = path.join(resourcesPath, 'app.asar.disabled');

    const hasExe = fs.existsSync(exePath);
    const hasResources = fs.existsSync(resourcesPath);
    const isValidFolder = hasExe;

    const hasLoader = fs.existsSync(loaderPath);
    const hasBotScript = fs.existsSync(installedBotPath);
    const isInstalled = hasLoader && hasBotScript;

    const hasBackup = fs.existsSync(originalAsar) || fs.existsSync(disabledAsar);

    // Hash check for bot.js
    const srcHash = getFileHash(BOT_SRC);
    const installedHash = getFileHash(installedBotPath);
    const loaderSrcHash = getFileHash(LOADER_SRC);
    const asarActive = fs.existsSync(path.join(resourcesPath, 'app.asar'));
    const loaderUpToDate = hasLoader && !asarActive && (loaderSrcHash === null || getFileHash(loaderPath) === loaderSrcHash);
    const isUpToDate = isInstalled && (srcHash !== null) && (installedHash === srcHash) && loaderUpToDate;

    // Read installed package.json version if available
    let loaderVersion = '1.0.0';
    try {
        const pkgPath = path.join(appDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.version) loaderVersion = pkg.version;
        }
    } catch (e) {}

    return {
        gamePath,
        defaultPath: getDefaultGamePath(),
        isValidFolder,
        hasExe,
        hasResources,
        isInstalled,
        isUpToDate,
        loaderUpToDate,
        asarActive,
        hasBackup,
        loaderVersion,
        // Inspect installed capability, not a version label. Older loaders ignore the protected flag and must be updated explicitly.
        protectedScriptCapable: hasLoader && !asarActive && hasProtectedLoaderCapability(loaderPath),
        botModifiedTime: fs.existsSync(installedBotPath) ? fs.statSync(installedBotPath).mtime : null,
        sourceBotModifiedTime: fs.existsSync(BOT_SRC) ? fs.statSync(BOT_SRC).mtime : null
    };
}

function installScript(overridePath) {
    const status = checkStatus(overridePath);
    const gamePath = status.gamePath;
    const resourcesPath = path.join(gamePath, 'resources');

    // Never "install" into a folder that isn't the game (it would report success but the game wouldn't load it)
    if (!hasGameExe(gamePath)) {
        return { success: false, error: `ไม่พบ ${GAME_EXE} ในโฟลเดอร์ "${gamePath}" — กด Auto-Detect หรือ Browse แล้วเลือกโฟลเดอร์ที่มีไฟล์ ${GAME_EXE}` };
    }
    try {
        return installFiles(gamePath, resourcesPath);
    } catch (e) {
        if (e && (e.code === 'EPERM' || e.code === 'EACCES')) return { success: false, needsAdmin: true, gamePath, error: e.message };
        return { success: false, error: 'ติดตั้งไม่สำเร็จ: ' + (e && e.message) };
    }
}

function installFiles(gamePath, resourcesPath) {
    if (!fs.existsSync(resourcesPath)) fs.mkdirSync(resourcesPath, { recursive: true });

    // 1. Backup app.asar if not already backed up
    const asarPath = path.join(resourcesPath, 'app.asar');
    const originalAsar = path.join(resourcesPath, 'app.asar.original');
    if (fs.existsSync(asarPath) && !fs.existsSync(originalAsar)) {
        try {
            fs.copyFileSync(asarPath, originalAsar);
            console.log('[Installer] Backed up original app.asar -> app.asar.original');
        } catch (e) {
            if (e.code === 'EPERM' || e.code === 'EACCES') throw e;
            console.warn('[Installer] Warning backing up app.asar:', e.message);
        }
    }
    // Move app.asar aside (like install_patch.bat) so the game always starts our loader in resources/app
    if (fs.existsSync(asarPath)) {
        const disabledAsar = path.join(resourcesPath, 'app.asar.disabled');
        if (fs.existsSync(disabledAsar)) fs.unlinkSync(disabledAsar);
        fs.renameSync(asarPath, disabledAsar);
    }

    // 2. Create resources/app directory
    const appDir = path.join(resourcesPath, 'app');
    if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
    }

    // 3. Write package.json
    const packageJsonPath = path.join(appDir, 'package.json');
    const pkgContent = LOADER_PACKAGE;
    fs.writeFileSync(packageJsonPath, JSON.stringify(pkgContent, null, 2), 'utf8');

    // 4. Copy loader main.js
    const targetLoaderPath = path.join(appDir, 'main.js');
    if (fs.existsSync(LOADER_SRC)) {
        fs.copyFileSync(LOADER_SRC, targetLoaderPath);
    } else {
        throw new Error('ไม่พบไฟล์ต้นฉบับ main.js ในโฟลเดอร์ Manager');
    }

    // 5. Copy bot.js
    const targetBotPath = path.join(resourcesPath, 'bot.js');
    if (fs.existsSync(BOT_SRC)) {
        fs.copyFileSync(BOT_SRC, targetBotPath);
    } else {
        throw new Error('ไม่พบไฟล์ต้นฉบับ bot.js ในโฟลเดอร์ Manager');
    }

    // Save game path to settings
    const settings = loadSettings();
    settings.gamePath = gamePath;
    saveSettings(settings);

    return {
        success: true,
        message: 'ติดตั้งและอัปเดตสคริปต์ PmheeAether ลงในเกมเรียบร้อยแล้ว!',
        gamePath,
        installedFiles: [
            targetLoaderPath,
            targetBotPath,
            packageJsonPath
        ]
    };
}

// Game in Program Files needs admin rights: stage the files, then copy them with one UAC prompt
function installScriptAsync(overridePath) {
    const first = installScript(overridePath);
    if (!first.needsAdmin) return Promise.resolve(first);
    const gamePath = first.gamePath;
    const res = path.join(gamePath, 'resources');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'pmhee-install-'));
    fs.copyFileSync(LOADER_SRC, path.join(stage, 'main.js'));
    fs.copyFileSync(BOT_SRC, path.join(stage, 'bot.js'));
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(LOADER_PACKAGE, null, 2), 'utf8');
    const q = p => "'" + String(p).replace(/'/g, "''") + "'";
    const script = [
        '$ErrorActionPreference = "Stop"',
        `$res = ${q(res)}; $stage = ${q(stage)}`,
        'New-Item -ItemType Directory -Force -Path (Join-Path $res "app") | Out-Null',
        'if ((Test-Path (Join-Path $res "app.asar")) -and -not (Test-Path (Join-Path $res "app.asar.original"))) { Copy-Item (Join-Path $res "app.asar") (Join-Path $res "app.asar.original") }',
        'if (Test-Path (Join-Path $res "app.asar")) { Remove-Item (Join-Path $res "app.asar.disabled") -Force -ErrorAction SilentlyContinue; Rename-Item (Join-Path $res "app.asar") "app.asar.disabled" }',
        'Copy-Item (Join-Path $stage "main.js") (Join-Path $res "app\\main.js") -Force',
        'Copy-Item (Join-Path $stage "package.json") (Join-Path $res "app\\package.json") -Force',
        'Copy-Item (Join-Path $stage "bot.js") (Join-Path $res "bot.js") -Force'
    ].join('\r\n');
    const ps1 = path.join(stage, 'install.ps1');
    fs.writeFileSync(ps1, '﻿' + script, 'utf8');
    const outer = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q('"' + ps1 + '"')}`;
    return new Promise(resolve => {
        execFile('powershell', ['-NoProfile', '-Command', outer], { windowsHide: true, timeout: 120000 }, (err) => {
            try { fs.rmSync(stage, { recursive: true, force: true }); } catch (e) {}
            const st = checkStatus(gamePath);
            if (st.isInstalled && st.loaderUpToDate) {
                const settings = loadSettings();
                settings.gamePath = gamePath;
                saveSettings(settings);
                resolve({ success: true, message: 'ติดตั้งสคริปต์ PmheeAether ลงในเกมเรียบร้อยแล้ว (ใช้สิทธิ์ผู้ดูแลระบบ)', gamePath });
            } else {
                resolve({ success: false, error: `เกมอยู่ในโฟลเดอร์ที่ต้องใช้สิทธิ์ผู้ดูแลระบบ (${gamePath}) — กด "Yes" ในหน้าต่างขอสิทธิ์ (UAC) หรือเปิด PelicanManager.exe แบบ Run as administrator แล้วกดติดตั้งอีกครั้ง` });
            }
        });
    });
}

function restoreOriginal(overridePath) {
    const status = checkStatus(overridePath);
    const gamePath = status.gamePath;
    const resourcesPath = path.join(gamePath, 'resources');
    const originalAsar = path.join(resourcesPath, 'app.asar.original');
    const asarPath = path.join(resourcesPath, 'app.asar');
    const appDir = path.join(resourcesPath, 'app');

    if (fs.existsSync(originalAsar)) {
        try {
            fs.copyFileSync(originalAsar, asarPath);
        } catch (e) {
            return { success: false, error: (e.code === 'EPERM' || e.code === 'EACCES')
                ? 'กู้คืนไม่สำเร็จ: โฟลเดอร์เกมต้องใช้สิทธิ์ผู้ดูแลระบบ — เปิด PelicanManager.exe แบบ Run as administrator แล้วลองใหม่'
                : 'กู้คืน app.asar ไม่สำเร็จ: ' + e.message };
        }
    }

    if (fs.existsSync(appDir)) {
        try {
            fs.rmSync(appDir, { recursive: true, force: true });
        } catch (e) {
            console.warn('[Installer] Could not remove app dir:', e.message);
        }
    }

    return {
        success: true,
        message: 'กู้คืนไฟล์เกมต้นฉบับเรียบร้อยแล้ว'
    };
}

function browseFolder() {
    return new Promise((resolve) => {
        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Aetheria Online Game Folder'; $f.ShowNewFolderButton = $false; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`;
        exec(psCmd, { windowsHide: false }, (err, stdout) => {
            if (err || !stdout) {
                return resolve({ success: false, path: null });
            }
            const selected = stdout.trim();
            if (selected) {
                return resolve({ success: true, path: selected });
            }
            resolve({ success: false, path: null });
        });
    });
}

function checkManagerOnlineUpdate() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/thegopza/aetheria-pelican-bot/commits/main',
            headers: {
                'User-Agent': 'PmheeAether-Manager-Updater'
            },
            timeout: 5000
        };

        const req = https.get(options, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.sha) {
                        return resolve({
                            success: true,
                            latestCommit: json.sha.substring(0, 7),
                            commitMessage: json.commit?.message || '',
                            commitDate: json.commit?.committer?.date || '',
                            htmlUrl: json.html_url || ''
                        });
                    }
                    resolve({ success: false, error: 'Invalid response from GitHub' });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
        });

        req.on('error', (err) => resolve({ success: false, error: err.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, error: 'Connection timed out' });
        });
    });
}

module.exports = {
    getDefaultGamePath,
    getEffectiveGamePath,
    checkStatus,
    installScript,
    installScriptAsync,
    restoreOriginal,
    browseFolder,
    saveSettings,
    loadSettings,
    checkManagerOnlineUpdate
};
