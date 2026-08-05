/**
 * File Check Service
 * Handles file existence verification and location across different storage locations
 */

import { join } from "../deps.ts";
import { ensureDir } from "https://deno.land/std@0.190.0/fs/ensure_dir.ts";
import {
  DOCUMENT_TYPE_DIRS,
  STORAGE_ROOT,
  WORKSPACE_ROOT,
} from "../config/storage.ts";

interface FileCheckResult {
  path: string;        // Path that was checked
  exists: boolean;     // Whether the file exists
  size?: number;       // Size of the file in bytes (if exists)
  extension?: string;  // File extension (if exists)
  isAbsolute: boolean; // Whether the path is absolute
  checked: string;     // Timestamp when the check was performed
}

const LOG_DIR = "./logs/file-checks";
let logInitialized = false;

/**
 * Document storage locations to check, in order of priority.
 * All derive from the canonical STORAGE_ROOT (config/storage.ts):
 *  - the per-document-type subdirectories (storage/thesis/, ...)
 *  - the storage root itself (bare filenames)
 *  - the workspace root, so DB paths stored relative to the repo
 *    (e.g. "storage/thesis/x.pdf") resolve correctly
 */
const STORAGE_LOCATIONS = [
  ...DOCUMENT_TYPE_DIRS.map((type) => join(STORAGE_ROOT, type)),
  STORAGE_ROOT,
  WORKSPACE_ROOT,
];

/**
 * Common file extensions to try if no extension is provided
 */
const COMMON_EXTENSIONS = [
  ".pdf",
  ".docx", 
  ".doc",
  ".pptx",
  ".ppt",
  ".xlsx",
  ".xls"
];

/**
 * Ensures the log directory exists
 */
async function initializeLogDir() {
  if (!logInitialized) {
    await ensureDir(LOG_DIR);
    logInitialized = true;
  }
}

/**
 * Logs a file check operation to a daily log file
 * @param idOrFilename The ID or filename being checked
 * @param results The check results
 */
async function logFileCheck(idOrFilename: string, results: FileCheckResult[]) {
  await initializeLogDir();
  
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logFile = join(LOG_DIR, `file-check-${date}.jsonl`);
  
  // Create a log entry with minimal info
  const foundCount = results.filter(r => r.exists).length;
  const logEntry = {
    timestamp: new Date().toISOString(),
    idOrFilename,
    checkedPaths: results.length,
    foundFiles: foundCount,
    firstFound: foundCount > 0 ? results.find(r => r.exists)?.path : null
  };
  
  try {
    await Deno.writeTextFile(logFile, JSON.stringify(logEntry) + '\n', { append: true });
    } catch (error) {
    // If the file doesn't exist, create it
    if (error instanceof Deno.errors.NotFound) {
      await Deno.writeTextFile(logFile, JSON.stringify(logEntry) + '\n');
    } else {
    }
    }
  }

  /**
 * Gets possible filenames to check based on an ID or filename
 * @param idOrFilename The document ID or filename to check
 * @returns Array of possible filenames to check
 */
function getPossibleFilenames(idOrFilename: string): string[] {
  const filenames: string[] = [];
  
  // Add the original name
  filenames.push(idOrFilename);
  
  // Check if it has an extension
  const hasExtension = /\.\w{2,4}$/.test(idOrFilename);
    
  // If no extension, add with common extensions
  if (!hasExtension) {
    for (const ext of COMMON_EXTENSIONS) {
      filenames.push(`${idOrFilename}${ext}`);
    }
  }
  
  return filenames;
}

export const FileCheckService = {
  /**
   * Finds a file in any of the standard storage locations
   * @param idOrFilename The document ID or filename to find
   * @param additionalLocations Optional additional locations to check
   * @returns Array of file check results
   */
  async findInStorage(
    idOrFilename: string, 
    additionalLocations: string[] = []
  ): Promise<FileCheckResult[]> {
    if (!idOrFilename) {
      return [];
    }
    
    const results: FileCheckResult[] = [];
    const possibleFilenames = getPossibleFilenames(idOrFilename);
    
    // Combine standard and additional locations
    const locationsToCheck = [...STORAGE_LOCATIONS, ...additionalLocations];
    
    // Check if the original path is absolute
    const isAbsolutePath = idOrFilename.startsWith('/') || 
                           /^[A-Za-z]:/.test(idOrFilename) || 
                           idOrFilename.startsWith('\\\\');
      
    // If it's an absolute path, check it directly
    if (isAbsolutePath) {
      try {
        const fileInfo = await Deno.stat(idOrFilename);
        const pathObj = new URL(`file://${idOrFilename.replace(/\\/g, '/')}`);
        const extension = pathObj.pathname.match(/\.\w{2,4}$/)?.[0] || undefined;
        
        results.push({
          path: idOrFilename,
          exists: fileInfo.isFile,
          size: fileInfo.isFile ? fileInfo.size : undefined,
          extension,
          isAbsolute: true,
          checked: new Date().toISOString()
        });
        
        // If found, no need to check other locations
        if (fileInfo.isFile) {
          await logFileCheck(idOrFilename, results);
          return results;
        }
      } catch (error) {
        // File doesn't exist or can't be accessed
        results.push({
          path: idOrFilename,
          exists: false,
          isAbsolute: true,
          checked: new Date().toISOString()
        });
      }
    }
    
    // Check each combination of location and filename
    for (const location of locationsToCheck) {
      for (const filename of possibleFilenames) {
        const fullPath = join(location, filename);
        
        try {
          const fileInfo = await Deno.stat(fullPath);
          // Get path relative to current working directory
          const relPath = fullPath.startsWith(Deno.cwd()) 
            ? fullPath.slice(Deno.cwd().length + 1) 
            : fullPath;
          const extension = fullPath.match(/\.\w{2,4}$/)?.[0] || undefined;
          
            results.push({
            path: fullPath,
            exists: fileInfo.isFile,
            size: fileInfo.isFile ? fileInfo.size : undefined,
            extension,
            isAbsolute: false,
            checked: new Date().toISOString()
          });
          
          // If found, no need to check other filenames in this location
          if (fileInfo.isFile) {
            break;
          }
        } catch (error) {
          // File doesn't exist or can't be accessed
          results.push({
            path: fullPath,
            exists: false,
            isAbsolute: false,
            checked: new Date().toISOString()
          });
        }
      }
    }
    
    // Log the check operation
    await logFileCheck(idOrFilename, results);
    
    return results;
  },

  /**
   * Gets full stats about a file if it exists
   * @param path Path to the file
   * @returns File info or null if not found
   */
  async getFileStats(path: string): Promise<Deno.FileInfo | null> {
    try {
      return await Deno.stat(path);
    } catch (error) {
      return null;
    }
  },
  
  /**
   * Checks if multiple files exist
   * @param paths Array of file paths to check
   * @returns Array of existing file paths
   */
  async checkMultipleFiles(paths: string[]): Promise<string[]> {
    const existingPaths: string[] = [];
    
    for (const path of paths) {
              try {
        const fileInfo = await Deno.stat(path);
                if (fileInfo.isFile) {
          existingPaths.push(path);
                  }
      } catch (error) {
        // File doesn't exist or can't be accessed
      }
    }
    
    return existingPaths;
        }
};

// Export a test function that can be called directly for debugging
export async function testFileLocations(fileNames: string[]): Promise<void> {
    
  for (const fileName of fileNames) {
        const results = await FileCheckService.findInStorage(fileName);
    
    const found = results.filter(r => r.exists);
    if (found.length > 0) {
            found.forEach((result, i) => {
              });
    } else {
          }
  }
} 