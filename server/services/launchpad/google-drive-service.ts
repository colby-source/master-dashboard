/**
 * google-drive-service.ts — Wraps Google Drive API for the Launchpad. Two jobs:
 *   1. Create a per-brand folder under the BMN Clients root.
 *   2. Upload files to that folder and return shareable URLs.
 *
 * Auth: OAuth2 with a long-lived refresh token (preferred for personal drives).
 * The refresh token must be created once via the OAuth playground or a custom
 * setup script and stored in env (GOOGLE_DRIVE_REFRESH_TOKEN). On each call, we
 * exchange it for a short-lived access token transparently.
 *
 * If GOOGLE_DRIVE_REFRESH_TOKEN is not configured, all methods throw. Callers
 * should check `googleDriveService.available` before invoking.
 */

import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('google-drive-service');

class GoogleDriveService {
  private driveClient: drive_v3.Drive | null = null;

  get available(): boolean {
    return !!(
      config.googleDrive.clientId &&
      config.googleDrive.clientSecret &&
      config.googleDrive.refreshToken
    );
  }

  private getClient(): drive_v3.Drive {
    if (this.driveClient) return this.driveClient;
    if (!this.available) {
      throw new Error('Google Drive not configured — set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN');
    }

    const oauth2Client = new google.auth.OAuth2(
      config.googleDrive.clientId,
      config.googleDrive.clientSecret,
    );
    oauth2Client.setCredentials({
      refresh_token: config.googleDrive.refreshToken,
    });

    this.driveClient = google.drive({ version: 'v3', auth: oauth2Client });
    return this.driveClient;
  }

  /**
   * Creates a folder under the BMN Clients root for a specific brand.
   * Returns folder metadata { id, url }. Idempotent — if a folder with the same
   * name already exists in the root, returns the existing one.
   */
  async createBrandFolder(brandSlug: string, brandName: string): Promise<{ id: string; url: string }> {
    const drive = this.getClient();
    const rootId = config.googleDrive.bmnClientsRootFolderId;

    if (!rootId) {
      throw new Error('GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID not configured');
    }

    const folderName = brandName;

    // Check for existing folder
    const existing = await drive.files.list({
      q: `'${rootId}' in parents and name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, webViewLink)',
      pageSize: 1,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      const folder = existing.data.files[0];
      log.info(`[Drive] Reusing existing folder for ${brandSlug}: ${folder.id}`);
      return {
        id: folder.id!,
        url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      };
    }

    // Create
    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [rootId],
      },
      fields: 'id, webViewLink',
    });

    log.info(`[Drive] Created brand folder for ${brandSlug}: ${created.data.id}`);

    return {
      id: created.data.id!,
      url: created.data.webViewLink || `https://drive.google.com/drive/folders/${created.data.id}`,
    };
  }

  /**
   * Creates a sub-folder (e.g. "Social", "Logos", "Photos") inside a brand folder.
   * Idempotent.
   */
  async createSubFolder(parentFolderId: string, name: string): Promise<{ id: string; url: string }> {
    const drive = this.getClient();

    const existing = await drive.files.list({
      q: `'${parentFolderId}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, webViewLink)',
      pageSize: 1,
    });

    if (existing.data.files && existing.data.files.length > 0) {
      const folder = existing.data.files[0];
      return {
        id: folder.id!,
        url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
      };
    }

    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id, webViewLink',
    });

    return {
      id: created.data.id!,
      url: created.data.webViewLink || `https://drive.google.com/drive/folders/${created.data.id}`,
    };
  }

  /**
   * Uploads a file buffer to Drive and returns the file's ID + shareable URL.
   * The file is set to be readable by anyone with the link (so the admin can
   * share with the brand without separate ACL ops).
   */
  async uploadFile(params: {
    folderId: string;
    filename: string;
    mimeType: string;
    body: Buffer | Readable;
  }): Promise<{ id: string; url: string; size: number }> {
    const drive = this.getClient();

    const stream = params.body instanceof Readable
      ? params.body
      : Readable.from(params.body);

    const created = await drive.files.create({
      requestBody: {
        name: params.filename,
        parents: [params.folderId],
      },
      media: {
        mimeType: params.mimeType,
        body: stream,
      },
      fields: 'id, webViewLink, size',
    });

    // Make the file accessible by anyone with the link (read-only)
    if (created.data.id) {
      try {
        await drive.permissions.create({
          fileId: created.data.id,
          requestBody: { role: 'reader', type: 'anyone' },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`[Drive] Could not set anyone-with-link permission on ${created.data.id}: ${msg}`);
      }
    }

    log.info(`[Drive] Uploaded ${params.filename} (${created.data.size} bytes) to folder ${params.folderId}`);

    return {
      id: created.data.id!,
      url: created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
      size: parseInt(String(created.data.size || 0)),
    };
  }

  /**
   * Creates a Google Doc from plain text/markdown content. Useful for writing
   * the 7 strategy modules as editable Google Docs (per BMN rule of no .md
   * files in BMN folders).
   */
  async createGoogleDoc(params: {
    folderId: string;
    title: string;
    content: string;
  }): Promise<{ id: string; url: string }> {
    const drive = this.getClient();

    const created = await drive.files.create({
      requestBody: {
        name: params.title,
        mimeType: 'application/vnd.google-apps.document',
        parents: [params.folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: Readable.from(params.content),
      },
      fields: 'id, webViewLink',
    });

    log.info(`[Drive] Created Google Doc "${params.title}": ${created.data.id}`);

    return {
      id: created.data.id!,
      url: created.data.webViewLink || `https://docs.google.com/document/d/${created.data.id}`,
    };
  }

  async deleteFile(fileId: string): Promise<void> {
    const drive = this.getClient();
    await drive.files.delete({ fileId });
    log.info(`[Drive] Deleted file ${fileId}`);
  }
}

export const googleDriveService = new GoogleDriveService();
