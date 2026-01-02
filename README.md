# Personal Launch Web Project

A Raycast extension to quickly launch your web development projects with Cursor, iTerm, and Chrome.

## Features

- **Quick Project Launcher** - Open projects in Cursor, iTerm, and Chrome with a single action
- **Smart Project Detection** - Automatically detects DDEV and Astro projects
- **Favorites** - Pin your frequently used projects for quick access
- **Recent Projects** - Tracks your 10 most recently opened projects
- **Auto-start Dev Servers** - Automatically runs `npm run dev` or `ddev npm run dev` based on project type
- **Auto-open Browser** - Opens the correct URL for your project (DDEV or localhost)
- **Organized Sections** - Projects grouped into Favorites, Recent, and All Projects

## Usage

1. Open Raycast and search for "Launch Web Project"
2. Browse or search for your project
3. Press Enter to open the project (Cursor + iTerm + Chrome)
4. Or use individual actions:
   - `Cmd+Enter` - Open in Cursor only
   - Select "Open in iTerm Only" - Start dev server only
   - Select "Open in Chrome Only" - Open browser only

### Keyboard Shortcuts

- `Cmd+F` - Add/remove project from favorites
- `Enter` - Open project (all apps)
- `Cmd+Shift+C` - Copy project path

## Supported Project Types

### DDEV Projects
- Detects: `.ddev/config.yaml`
- Runs: `ddev npm run dev`
- Opens: `https://[projectname].ddev.site`

### Astro Projects
- Detects: `astro` in package.json dependencies
- Runs: `npm run dev`
- Opens: `http://localhost:4321/`

## Configuration

By default, the extension looks for projects in `~/Sites`. To change this:

1. Open the extension source code
2. Edit line 9 in `src/index.tsx`:
   ```typescript
   const BASE_FOLDER = `${homedir()}/Sites`;
   ```
3. Rebuild the extension: `npm run build`

## Installation

### From Source

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Import into Raycast:
   - Open Raycast
   - Search for "Import Extension"
   - Select this project folder

### Development Mode

To run in development mode with hot reload:

```bash
npm run dev
```

## Requirements

- [Raycast](https://raycast.com/) - macOS productivity app
- [Cursor](https://cursor.sh/) - AI-powered code editor
- [iTerm2](https://iterm2.com/) - Terminal emulator
- [Google Chrome](https://www.google.com/chrome/) - Web browser

## Project Structure

```
project-launcher/
├── src/
│   └── index.tsx          # Main extension code
├── package.json           # Extension metadata
├── tsconfig.json          # TypeScript configuration
└── README.md             # This file
```

## How It Works

1. **Project Detection**: Scans your projects folder for directories
2. **Type Detection**: Checks for `.ddev/config.yaml` or Astro in `package.json`
3. **Smart Sorting**: Favorites first, then recent projects, then alphabetical
4. **Local Storage**: Favorites and recent projects persist across sessions
5. **Multi-App Launch**: Opens Cursor, starts dev server in iTerm, and opens browser

## Features in Detail

### Favorites
- Click any project and press `Cmd+F` to favorite it
- Favorited projects appear at the top with a star icon
- Favorites persist across Raycast restarts

### Recent Projects
- Automatically tracks the last 10 opened projects
- Shows a clock icon for recently opened projects
- Appears after favorites but before other projects

### Project Tags
- **Blue "DDEV" tag** - DDEV project detected
- **Red "Astro" tag** - Astro project detected
- **Star icon** - Favorited project
- **Clock icon** - Recently opened project

## Troubleshooting

### Projects not showing up
- Make sure your projects are in `~/Sites` (or your configured folder)
- Check that the folder is readable
- Try reloading the extension

### iTerm not opening
- Make sure iTerm2 is installed
- Grant Raycast accessibility permissions in System Preferences

### Chrome not opening
- Make sure Google Chrome is installed in `/Applications`
- Check that the URL is correct for your project type

### Dev server not starting
- Verify `package.json` has a `dev` script
- For DDEV projects, ensure DDEV is running

## Contributing

Suggestions and improvements are welcome! This is a personal project but feel free to:
- Report bugs
- Suggest features
- Share your improvements

## License

MIT License - see LICENSE file for details

## Author

Built for quickly launching web development projects with a single keystroke.

## Changelog

### 1.0.0 (Initial Release)
- Quick project launcher for Cursor, iTerm, and Chrome
- DDEV and Astro project detection
- Favorites and recent projects
- Organized sections with visual indicators
