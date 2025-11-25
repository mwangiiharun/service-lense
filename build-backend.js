#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;
const backendDir = path.join(scriptDir, 'backend');
const binariesDir = path.join(scriptDir, 'app', 'src-tauri', 'binaries');

// Determine OS and architecture
const platform = process.platform;
const arch = process.arch;

let goos, goarch, binaryName;

switch (platform) {
  case 'darwin':
    goos = 'darwin';
    binaryName = 'backend';
    break;
  case 'linux':
    goos = 'linux';
    binaryName = 'backend';
    break;
  case 'win32':
    goos = 'windows';
    binaryName = 'backend.exe';
    break;
  default:
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
}

switch (arch) {
  case 'x64':
    goarch = 'amd64';
    break;
  case 'arm64':
    goarch = 'arm64';
    break;
  default:
    goarch = arch;
}

console.log(`Building backend for ${goos}/${goarch}...`);

// Create binaries directory if it doesn't exist
if (!fs.existsSync(binariesDir)) {
  fs.mkdirSync(binariesDir, { recursive: true });
}

// Determine target triple for Tauri
let targetTriple;
if (platform === 'darwin') {
  targetTriple = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
} else if (platform === 'linux') {
  targetTriple = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
} else if (platform === 'win32') {
  targetTriple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
}

// Build the binary with platform-specific name for Tauri
const tauriBinaryName = `backend-${targetTriple}`;
const outputPath = path.join(binariesDir, tauriBinaryName);
const env = { ...process.env, GOOS: goos, GOARCH: goarch };

try {
  execSync(`go build -o "${outputPath}" .`, {
    cwd: backendDir,
    env: env,
    stdio: 'inherit'
  });
  console.log(`Backend binary built successfully: ${outputPath}`);
} catch (error) {
  console.error('Failed to build backend:', error.message);
  process.exit(1);
}

