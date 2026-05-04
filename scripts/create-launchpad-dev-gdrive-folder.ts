/**
 * One-off: create a `_DEV` sandbox folder under the BMN/Clients root in Google Drive.
 * Devs use this folder ID as GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID to avoid
 * polluting the live client tree.
 *
 * Run: tsx scripts/create-launchpad-dev-gdrive-folder.ts
 */
import 'dotenv/config';
import { google } from 'googleapis';

const FOLDER_NAME = '_DEV';

async function main() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const rootId = process.env.GOOGLE_DRIVE_BMN_CLIENTS_ROOT_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken || !rootId) {
    throw new Error(
      'Missing Google Drive env: GOOGLE_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _BMN_CLIENTS_ROOT_FOLDER_ID',
    );
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const drive = google.drive({ version: 'v3', auth: oauth });

  const existing = await drive.files.list({
    q: `'${rootId}' in parents and name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    const f = existing.data.files[0];
    process.stdout.write(`REUSED\nid=${f.id}\nurl=${f.webViewLink}\n`);
    return;
  }

  const created = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootId],
    },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });

  process.stdout.write(`CREATED\nid=${created.data.id}\nurl=${created.data.webViewLink}\n`);
}

main().catch((err) => {
  process.stderr.write(`FAILED: ${err.message}\n`);
  process.exit(1);
});
