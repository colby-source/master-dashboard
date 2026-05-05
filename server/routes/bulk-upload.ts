import { Router } from 'express';
import { queryOne, queryAll, runSql, saveDb } from '../db';
import { enrichmentService } from '../services/enrichment-service';
import { wsServer } from '../websocket/ws-server';
import { createLogger } from '../utils/logger';
const log = createLogger('bulk-upload');

const router = Router();

// ── POST /bulk-upload — Insert CSV leads & optionally start processing ──

router.post('/', async (req, res) => {
  try {
    const { company_id, file_name, leads, auto_process = true, target_campaign_id, column_mapping } = req.body;

    if (!company_id || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'company_id and non-empty leads array required' });
    }

    // Verify company exists
    const company = queryOne('SELECT id FROM companies WHERE id = ?', [company_id]);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const errors: { row: number; error: string }[] = [];
    const insertedIds: number[] = [];
    let duplicateCount = 0;
    const timestamp = Date.now();

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];

      // Validate: email is required
      if (!lead.email || typeof lead.email !== 'string' || !lead.email.includes('@')) {
        errors.push({ row: i + 1, error: 'Missing or invalid email' });
        continue;
      }

      const email = lead.email.trim().toLowerCase();

      // Check for duplicate by email + company_id
      const existing = queryOne(
        'SELECT id FROM enrichment_leads WHERE email = ? AND company_id = ?',
        [email, company_id]
      );

      if (existing) {
        duplicateCount++;
        continue;
      }

      const ghlContactId = `csv_${timestamp}_${i}`;

      try {
        runSql(
          `INSERT INTO enrichment_leads (company_id, ghl_contact_id, email, phone, first_name, last_name, source, status, instantly_campaign_id, instantly_push_status)
           VALUES (?, ?, ?, ?, ?, ?, 'csv_import', 'pending', ?, ?)`,
          [
            company_id,
            ghlContactId,
            email,
            lead.phone?.trim() || null,
            lead.first_name?.trim() || null,
            lead.last_name?.trim() || null,
            target_campaign_id || null,
            target_campaign_id ? 'pushed' : 'awaiting_approval',
          ]
        );

        const inserted = queryOne(
          'SELECT id FROM enrichment_leads WHERE ghl_contact_id = ? AND company_id = ? ORDER BY id DESC LIMIT 1',
          [ghlContactId, company_id]
        );
        if (inserted) insertedIds.push(inserted.id);
      } catch (err: any) {
        errors.push({ row: i + 1, error: err.message || 'Insert failed' });
      }
    }

    saveDb();

    // Create bulk_imports record
    runSql(
      `INSERT INTO bulk_imports (company_id, file_name, total_rows, inserted_count, duplicate_count, error_count, status, lead_ids, error_details, column_mapping, auto_process, target_campaign_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id,
        file_name || 'upload.csv',
        leads.length,
        insertedIds.length,
        duplicateCount,
        errors.length,
        auto_process && insertedIds.length > 0 ? 'processing' : 'complete',
        JSON.stringify(insertedIds),
        errors.length > 0 ? JSON.stringify(errors) : null,
        column_mapping ? JSON.stringify(column_mapping) : null,
        auto_process ? 1 : 0,
        target_campaign_id || null,
      ]
    );
    saveDb();

    const importRecord = queryOne('SELECT id FROM bulk_imports ORDER BY id DESC LIMIT 1');
    const importId = importRecord?.id;

    // Start background processing if requested
    if (auto_process && insertedIds.length > 0) {
      enrichmentService.bulkProcessImport(importId, insertedIds, target_campaign_id).catch(err => {
        log.error('[BulkUpload] Background processing error:', err.message);
      });
    }

    res.json({
      import_id: importId,
      total_rows: leads.length,
      inserted: insertedIds.length,
      duplicates: duplicateCount,
      errors,
      lead_ids: insertedIds,
    });
  } catch (err: any) {
    log.error('[BulkUpload] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /bulk-uploads — List past imports ────────────────────

router.get('/', (req, res) => {
  const imports = queryAll(
    'SELECT * FROM bulk_imports ORDER BY created_at DESC LIMIT 50'
  );
  res.json(imports);
});

// ── GET /bulk-uploads/:id — Single import status ─────────────

router.get('/:id', (req, res) => {
  const record = queryOne('SELECT * FROM bulk_imports WHERE id = ?', [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Import not found' });
  res.json(record);
});

// ── POST /bulk-uploads/:id/cancel — Cancel in-progress import ──

router.post('/:id/cancel', (req, res) => {
  const record = queryOne('SELECT * FROM bulk_imports WHERE id = ?', [req.params.id]);
  if (!record) return res.status(404).json({ error: 'Import not found' });

  if (record.status !== 'processing') {
    return res.status(400).json({ error: 'Import is not currently processing' });
  }

  runSql(
    `UPDATE bulk_imports SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`,
    [req.params.id]
  );
  saveDb();

  res.json({ success: true });
});

export default router;
