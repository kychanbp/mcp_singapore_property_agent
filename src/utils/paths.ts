import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

/**
 * Get the OS-appropriate application data directory for storing database files
 * This ensures consistent database location regardless of working directory
 */
export function getAppDataDir(): string {
  // Use standard app data locations per OS
  let appDataDir: string;
  
  if (process.platform === 'win32') {
    // Windows: Use APPDATA environment variable or fallback
    appDataDir = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    // macOS: Use ~/Library/Application Support
    appDataDir = join(homedir(), 'Library', 'Application Support');
  } else {
    // Linux/Unix: Use XDG_DATA_HOME or ~/.local/share
    appDataDir = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  }
  
  // Create our app-specific subdirectory
  const mcpAppDir = join(appDataDir, 'mcp-property-search');
  
  // Ensure directory exists
  if (!existsSync(mcpAppDir)) {
    mkdirSync(mcpAppDir, { recursive: true });
  }
  
  return mcpAppDir;
}

/**
 * Get the default database file path using OS-appropriate app data directory
 */
export function getDefaultDatabasePath(): string {
  return join(getAppDataDir(), 'properties.db');
}

/**
 * Get database path with environment variable override support
 */
export function getDatabasePath(): string {
  // Allow override via environment variable
  if (process.env.MCP_PROPERTY_DB_PATH) {
    const customPath = process.env.MCP_PROPERTY_DB_PATH;
    
    // Ensure parent directory exists for custom paths
    const parentDir = join(customPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    
    return customPath;
  }
  
  return getDefaultDatabasePath();
}