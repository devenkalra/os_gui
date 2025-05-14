# OS Services UI

A Tauri-based desktop application for managing OS services, starting with a file manager and expandable to include image processing, video processing, and more.

## Features

- File Manager
  - Browse directories
  - Create new folders
  - Rename files and folders
  - Delete files and folders
  - Search files
  - View file details (size, modification date)

## Prerequisites

- Node.js (v16 or later)
- Python 3.8 or later
- Rust (for Tauri)

## Setup

1. Install dependencies:
   ```bash
   # Install frontend dependencies
   npm install

   # Install Python backend dependencies
   cd backend
   pip install -r requirements.txt
   cd ..
   ```

2. Start the development servers:
   ```bash
   # Start the Python backend
   cd backend
   python main.py

   # In a new terminal, start the Tauri frontend
   npm run tauri dev
   ```

## Project Structure

- `src/` - React frontend code
  - `components/` - React components
  - `App.tsx` - Main application component
  - `main.tsx` - Application entry point
- `backend/` - Python backend code
  - `main.py` - FastAPI server implementation
- `src-tauri/` - Tauri configuration and native code

## Adding New Services

To add a new service:

1. Create a new component in `src/components/`
2. Add the service to the menu items in `src/App.tsx`
3. Implement the backend API endpoints in `backend/main.py`
4. Add the service route in `src/App.tsx`

## Building

To build the application:

```bash
npm run tauri build
```

The built application will be available in `src-tauri/target/release/`. 