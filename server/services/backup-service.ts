import fs from 'fs';
import path from 'path';
import { config } from '../config';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackupResult {
  success: boolean;
  localPath: string | null;
  onedrivePath: string | null;
  cleanedCount: number;
  error?: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const LOCAL_BACKUP_BASE = path.resolve('./backups');
const ONEDRIVE_BACKUP_BASE = process.env.ONEDRIVE_BACKUP_PATH || 'C:/Users/colby/OneDrive/Backups/MasterDashboard';

const RETENTION = {
  daily: 7,
  weekly: 4,
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyFileSafe(src: string, dest: string): void {
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  fs.copyFileSync(src, dest);
}

/**
 * Parse a date string from a backup filename like `master-dashboard-2026-03-16.db`.
 * Returns null if the filename does not match the expected pattern.
 */
function parseDateFromFilename(filename: string): Date | null {
  const match = filename.match(/master-dashboard-(\d{4}-\d{2}-\d{2})\.db$/);
  if (!match) return null;
  const date = new Date(match[1] + 'T00:00:00');
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * List backup files in a directory sorted by date descending (newest first).
 */
function listBackups(dirPath: string): { filename: string; date: Date; fullPath: string }[] {
  if (!fs.existsSync(dirPath)) return [];

  return fs.readdirSync(dirPath)
    .map(filename => {
      const date = parseDateFromFilename(filename);
      if (!date) return null;
      return { filename, date, fullPath: path.join(dirPath, filename) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

// ─── Core functions ─────────────────────────────────────────────────────────

/**
 * Run a full database backup: copies the SQLite file to local and OneDrive
 * directories, with daily and weekly tiers.
 */
export async function runBackup(): Promise<BackupResult> {
  const dbPath = path.resolve(config.dbPath);
  const now = new Date();
  const dateStr = formatDate(now);
  const backupFilename = `master-dashboard-${dateStr}.db`;

  // Validate source database exists
  if (!fs.existsSync(dbPath)) {
    const error = `Database file not found at ${dbPath}`;
    console.error(`[Backup] ${error}`);
    return { success: false, localPath: null, onedrivePath: null, cleanedCount: 0, error };
  }

  let localPath: string | null = null;
  let onedrivePath: string | null = null;
  const sunday = isSunday(now);

  // ── Local backup ────────────────────────────────────────────────────────
  try {
    const localDailyDir = path.join(LOCAL_BACKUP_BASE, 'daily');
    const localDailyPath = path.join(localDailyDir, backupFilename);
    copyFileSafe(dbPath, localDailyPath);
    localPath = localDailyPath;
    console.log(`[Backup] Local daily backup saved: ${localDailyPath}`);

    if (sunday) {
      const localWeeklyDir = path.join(LOCAL_BACKUP_BASE, 'weekly');
      const localWeeklyPath = path.join(localWeeklyDir, backupFilename);
      copyFileSafe(dbPath, localWeeklyPath);
      console.log(`[Backup] Local weekly backup saved: ${localWeeklyPath}`);
    }
  } catch (err: any) {
    const error = `Local backup failed: ${err.message}`;
    console.error(`[Backup] ${error}`);
    return { success: false, localPath: null, onedrivePath: null, cleanedCount: 0, error };
  }

  // ── OneDrive backup ─────────────────────────────────────────────────────
  try {
    const onedriveDailyDir = path.join(ONEDRIVE_BACKUP_BASE, 'daily');
    const onedriveDailyPath = path.join(onedriveDailyDir, backupFilename);
    copyFileSafe(dbPath, onedriveDailyPath);
    onedrivePath = onedriveDailyPath;
    console.log(`[Backup] OneDrive daily backup saved: ${onedriveDailyPath}`);

    if (sunday) {
      const onedriveWeeklyDir = path.join(ONEDRIVE_BACKUP_BASE, 'weekly');
      const onedriveWeeklyPath = path.join(onedriveWeeklyDir, backupFilename);
      copyFileSafe(dbPath, onedriveWeeklyPath);
      console.log(`[Backup] OneDrive weekly backup saved: ${onedriveWeeklyPath}`);
    }
  } catch (err: any) {
    console.warn(`[Backup] OneDrive backup skipped — ${err.message}`);
    // OneDrive failure is non-fatal; continue with local-only
  }

  // ── Cleanup old backups ─────────────────────────────────────────────────
  let cleanedCount = 0;
  try {
    cleanedCount = cleanOldBackups();
  } catch (err: any) {
    console.warn(`[Backup] Cleanup encountered an error: ${err.message}`);
  }

  console.log(`[Backup] Complete — local: ${localPath}, onedrive: ${onedrivePath ?? 'unavailable'}, cleaned: ${cleanedCount}`);

  return { success: true, localPath, onedrivePath, cleanedCount };
}

/**
 * Remove backups that exceed the retention policy.
 * Daily: keep last 7 days. Weekly: keep last 4 Sunday backups.
 * Cleans both local and OneDrive directories.
 *
 * Returns the total number of files removed.
 */
export function cleanOldBackups(): number {
  let totalCleaned = 0;

  const directories = [
    { base: LOCAL_BACKUP_BASE, label: 'local' },
    { base: ONEDRIVE_BACKUP_BASE, label: 'onedrive' },
  ];

  for (const { base, label } of directories) {
    // Daily retention
    const dailyDir = path.join(base, 'daily');
    totalCleaned += cleanDirectory(dailyDir, RETENTION.daily, label);

    // Weekly retention
    const weeklyDir = path.join(base, 'weekly');
    totalCleaned += cleanDirectory(weeklyDir, RETENTION.weekly, label);
  }

  return totalCleaned;
}

/**
 * Remove files in a backup directory beyond the retention count.
 * Files are sorted newest-first; those beyond `keep` are deleted.
 */
function cleanDirectory(dirPath: string, keep: number, label: string): number {
  let cleaned = 0;

  try {
    const backups = listBackups(dirPath);
    const toRemove = backups.slice(keep);

    for (const entry of toRemove) {
      try {
        fs.unlinkSync(entry.fullPath);
        cleaned++;
        console.log(`[Backup] Removed old ${label} backup: ${entry.filename}`);
      } catch (err: any) {
        console.warn(`[Backup] Failed to remove ${entry.fullPath}: ${err.message}`);
      }
    }
  } catch (err: any) {
    // Directory may not exist (e.g., OneDrive offline) — not an error
    if (err.code !== 'ENOENT') {
      console.warn(`[Backup] Could not clean ${label} directory ${dirPath}: ${err.message}`);
    }
  }

  return cleaned;
}
