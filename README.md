# ServiceLens

A powerful desktop application for inspecting and interacting with gRPC services. ServiceLens provides a beautiful, Postman-like interface for discovering, testing, and monitoring gRPC backends without requiring any modifications to your services.

## Features

- 🔍 **Dynamic Service Discovery** - Automatically discovers gRPC services and methods via reflection
- 🧪 **Interactive Playground** - Test gRPC methods with JSON payloads and file uploads
- 📊 **Real-time Dashboard** - Monitor service health, traffic, and performance metrics
- 🧭 **Schema Explorer** - Browse available methods, services, and their schemas
- 📡 **Traffic Monitoring** - View captured gRPC calls with request/response payloads
- 🎨 **Modern UI** - Beautiful dark/light theme with responsive design
- 🔄 **Background Introspection** - Automatically discovers new endpoints every 10 minutes
- 📁 **File Uploads** - Support for binary fields with file upload interface
- 💾 **Request Saving** - Save and reuse your favorite requests

## Architecture

ServiceLens consists of three main components:

1. **Go Backend Proxy** (`backend/`) - Handles gRPC-Web translation, reflection, and dynamic invocation
2. **React Frontend** (`app/`) - Modern UI built with React, TypeScript, and Tailwind CSS
3. **Tauri Desktop App** (`app/src-tauri/`) - Cross-platform desktop wrapper

## Prerequisites

- **Go** 1.21+ (for the backend)
- **Node.js** 18+ and npm (for the frontend)
- **Rust** (for Tauri - installed automatically if needed)

## Getting Started

### Development

1. **Clone the repository**
   ```bash
   git clone git@github.com:mwangiiharun/service-lense.git
   cd service-lense
   ```

2. **Start the backend** (in one terminal)
   ```bash
   cd backend
   export GRPS_BACKEND_ADDR=localhost:9090  # Your gRPC backend address
   export GRPS_ALLOW_ORIGINS=http://localhost:5173
   export GRPS_BACKEND_USE_TLS=false
   export GRPS_HTTP_ADDR=:8081
   go run .
   ```

3. **Start the frontend** (in another terminal)
   ```bash
   cd app
   npm install
   npm run tauri
   ```

### Building

### Local Build

Build the complete desktop application locally:

```bash
cd app
npm install
npm run build:tauri
```

This will:
- Build the Go backend binary
- Build the React frontend
- Package everything into a Tauri desktop app

### Creating a Release DMG Locally

To create a release DMG for macOS:

1. **Build the backend binary for your architecture:**
   ```bash
   # From the project root
   mkdir -p app/src-tauri/binaries
   cd backend
   
   # For Apple Silicon (M1/M2/M3)
   GOOS=darwin GOARCH=arm64 go build -o ../app/src-tauri/binaries/backend-aarch64-apple-darwin .
   chmod +x ../app/src-tauri/binaries/backend-aarch64-apple-darwin
   
   # For Intel Macs
   GOOS=darwin GOARCH=amd64 go build -o ../app/src-tauri/binaries/backend-x86_64-apple-darwin .
   chmod +x ../app/src-tauri/binaries/backend-x86_64-apple-darwin
   ```

2. **Build the frontend:**
   ```bash
   cd app
   npm install
   npm run build
   ```

3. **Build the Tauri app and create DMG:**
   ```bash
   cd app
   npx tauri build --bundles dmg
   ```

4. **Verify the DMG contents:**
   ```bash
   # Find the DMG
   DMG_PATH=$(find app/src-tauri/target/release/bundle/dmg -name "*.dmg" | head -1)
   
   # Mount it
   hdiutil attach "$DMG_PATH" -mountpoint /tmp/servicelens_dmg
   
   # Check for backend binary
   find /tmp/servicelens_dmg -name "*backend*"
   
   # Check Resources directory
   find /tmp/servicelens_dmg -name "ServiceLens.app" -type d | head -1 | xargs -I {} ls -la {}/Contents/Resources/
   
   # Unmount
   hdiutil detach /tmp/servicelens_dmg
   ```

The DMG will be located at:
- `app/src-tauri/target/release/bundle/dmg/ServiceLens_0.2.0_x64.dmg` (Intel)
- `app/src-tauri/target/release/bundle/dmg/ServiceLens_0.2.0_aarch64.dmg` (Apple Silicon)

**Note:** The backend binary must be built for the target architecture before running `tauri build`. The binary will be bundled into the DMG and accessible at runtime.

### Release Builds

Release builds are automated via GitHub Actions. The pipeline builds:
- **macOS**: DMG installer (supports both Intel and Apple Silicon)
- **Windows**: NSIS installer (.exe)

#### Creating a Release

1. **Automatic (via tag)**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Manual (via GitHub UI)**:
   - Go to Actions → Release workflow
   - Click "Run workflow"
   - Enter version tag (e.g., `v1.0.0`)

The workflow will:
- Build backend binaries for all platforms
- Build Tauri app for macOS and Windows
- Create a GitHub Release with DMG and EXE installers

## Configuration

### Backend Environment Variables

- `GRPS_BACKEND_ADDR` - Target gRPC backend address (default: `localhost:9090`)
- `GRPS_HTTP_ADDR` - HTTP server address for the proxy (default: `:8081`)
- `GRPS_BACKEND_USE_TLS` - Enable TLS for backend connection (default: `false`)
- `GRPS_ALLOW_ORIGINS` - Comma-separated list of allowed CORS origins
- `GRPS_AUTO_ALLOW_DEV_ORIGINS` - Auto-allow local dev origins (default: `true`)

### Frontend Settings

Configure backend profiles and settings through the Settings page in the app. Settings are persisted in browser localStorage.

## Usage

1. **Connect to a Backend**
   - Select or create a backend profile
   - Enter the backend address (e.g., `http://localhost:8081`)
   - Click "Connect" to discover services

2. **Explore Services**
   - Use the Explorer to browse available methods
   - Click on any method to jump to the Playground

3. **Test Methods**
   - Select a method in the Playground
   - Edit the JSON payload
   - Upload files for binary fields
   - Click "Invoke Request" to test

4. **Monitor Traffic**
   - View the Traffic page for real-time call monitoring
   - See request/response payloads and timing

5. **View Dashboard**
   - Check service health and metrics
   - See top methods and recent activity

## Project Structure

```
service-lense/
├── backend/              # Go gRPC proxy server
│   ├── main.go          # Server setup and routing
│   ├── schema.go        # Reflection and schema collection
│   ├── invoke.go        # Dynamic gRPC invocation
│   ├── capabilities.go  # Capability manifest generation
│   └── traffic.go       # Traffic logging
├── app/                 # React frontend
│   ├── src/
│   │   ├── pages/       # Page components
│   │   ├── components/  # Reusable components
│   │   ├── lib/         # Utilities and API clients
│   │   └── styles.css   # Global styles
│   └── src-tauri/       # Tauri configuration
└── README.md
```

## Development

### Backend Development

The Go backend uses:
- `google.golang.org/grpc` for gRPC client
- `github.com/jhump/protoreflect` for dynamic reflection
- `github.com/improbable-eng/grpc-web` for gRPC-Web support

### Frontend Development

The React frontend uses:
- React 18 with TypeScript
- Vite for building
- Tailwind CSS for styling
- Tauri for desktop integration

## License

[Add your license here]

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- Uses [protoreflect](https://github.com/jhump/protoreflect) for gRPC reflection
- Icons from [Material Design Icons](https://iconify.design/)

