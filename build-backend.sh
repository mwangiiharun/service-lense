#!/bin/bash

# Build script for Go backend
# This script builds the backend binary and places it in the Tauri binaries directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
BINARIES_DIR="${SCRIPT_DIR}/app/src-tauri/binaries"

# Determine OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Map architecture names
case $ARCH in
    x86_64)
        GOARCH="amd64"
        ;;
    arm64|aarch64)
        GOARCH="arm64"
        ;;
    *)
        GOARCH="$ARCH"
        ;;
esac

# Map OS names
case $OS in
    darwin)
        GOOS="darwin"
        BINARY_NAME="backend"
        ;;
    linux)
        GOOS="linux"
        BINARY_NAME="backend"
        ;;
    mingw*|msys*|cygwin*|windows*)
        GOOS="windows"
        BINARY_NAME="backend.exe"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

echo "Building backend for $GOOS/$GOARCH..."

# Create binaries directory if it doesn't exist
mkdir -p "$BINARIES_DIR"

# Build the binary
cd "$BACKEND_DIR"
GOOS=$GOOS GOARCH=$GOARCH go build -o "$BINARIES_DIR/$BINARY_NAME" .

echo "Backend binary built successfully: $BINARIES_DIR/$BINARY_NAME"

