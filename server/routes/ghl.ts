import { Router, Request, Response, NextFunction } from 'express';
import { ghlService } from '../services/ghl-service';
import { AppError } from '../middleware/error-handler';

const router = Router();

function getCompanyId(req: Request): number {
  return req.query.company_id ? parseInt(req.query.company_id as string) : 1;
}

/**
 * Helper: get a GHL client or throw AppError(404).
 * Eliminates repetitive null-check + manual res.status(404) across routes.
 */
function requireClient(req: Request) {
  const client = ghlService.getClient(getCompanyId(req));
  if (!client) {
    throw new AppError(404, 'GHL_LOCATION_NOT_FOUND', 'GHL location not found for the given company');
  }
  return client;
}

// ── Status ──────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = ghlService.getAllClients();
    const locations = clients.map(c => ({
      name: c.location.name,
      companyId: c.location.companyId,
      locationId: c.location.locationId,
      hasAccess: c.hasAccess,
      lastError: c.lastError,
    }));
    res.json({ locations, configured: clients.length > 0 });
  } catch (err) {
    next(err);
  }
});

// ── Contacts ────────────────────────────────────────────────
router.get('/contacts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = req.query;
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ contacts: [], meta: { total: 0 } });
    const data = await client.searchContacts(query as string);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/contacts/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.getContact(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/contacts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.createContact(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/contacts/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.updateContact(req.params.id, req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/contacts/:id/tags', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.addContactTags(req.params.id, req.body.tags);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/contacts/:id/tags', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.removeContactTags(req.params.id, req.body.tags);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/contacts/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json([]);
    const data = await client.getContactTasks(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/contacts/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json([]);
    const data = await client.getContactNotes(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/contacts/:id/notes', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.createContactNote(req.params.id, req.body.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── Workflows ───────────────────────────────────────────────
router.post('/contacts/:id/workflow/:workflowId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.addContactToWorkflow(req.params.id, req.params.workflowId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/contacts/:id/workflow/:workflowId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.removeContactFromWorkflow(req.params.id, req.params.workflowId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── Pipelines & Opportunities ───────────────────────────────
router.get('/pipelines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ pipelines: [] });
    const data = await client.getPipelines();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.get('/opportunities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { pipeline_id } = req.query;
    if (!pipeline_id) {
      throw new AppError(400, 'VALIDATION_ERROR', 'pipeline_id query parameter is required');
    }
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ opportunities: [] });
    const data = await client.getOpportunities(pipeline_id as string);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/opportunities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.createOpportunity(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/opportunities/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.updateOpportunity(req.params.id, req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/opportunities/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.deleteOpportunity(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.put('/opportunities/:id/stage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const { stageId } = req.body;
    if (!stageId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'stageId is required');
    }
    const data = await client.updateOpportunityStage(req.params.id, stageId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── Pipelines across all locations ──────────────────────────
router.get('/pipelines/all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = ghlService.getAllClients();
    const results: any[] = [];
    for (const client of clients) {
      if (!client.hasAccess) continue;
      const data = await client.getPipelines();
      const pipelines = data?.pipelines || [];
      for (const p of pipelines) {
        const opps = await client.getOpportunities(p.id);
        results.push({
          ...p,
          companyId: client.location.companyId,
          companyName: client.location.name,
          opportunityCount: opps?.opportunities?.length || 0,
          totalValue: (opps?.opportunities || []).reduce((s: number, o: any) => s + (o.monetaryValue || 0), 0),
        });
      }
    }
    res.json({ pipelines: results });
  } catch (err) {
    next(err);
  }
});

// ── GHL Campaigns ───────────────────────────────────────────
router.get('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ campaigns: [] });
    const data = await client.getCampaigns();
    res.json({ campaigns: data });
  } catch (err) {
    next(err);
  }
});

// ── Conversations ───────────────────────────────────────────
router.get('/conversations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = req.query;
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ conversations: [] });
    const data = await client.searchConversations(query as string);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.sendMessage(req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── Tags, Fields, Templates ─────────────────────────────────
router.get('/tags', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ tags: [] });
    const data = await client.getLocationTags();
    res.json({ tags: data });
  } catch (err) {
    next(err);
  }
});

router.get('/custom-fields', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ customFields: [] });
    const data = await client.getCustomFields();
    res.json({ customFields: data });
  } catch (err) {
    next(err);
  }
});

router.post('/custom-fields/audit-presence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const { fieldId } = req.body || {};
    if (!fieldId) return res.status(400).json({ success: false, error: { message: 'fieldId required' } });
    const all = await client.getAllContacts();
    const hasValue = (c: any, id: string) => {
      const f = (c.customFields || []).find((x: any) => x.id === id);
      return f?.value != null && String(f.value).trim().length > 0;
    };
    const withField: any[] = [];
    const withoutField: any[] = [];
    for (const c of all) (hasValue(c, fieldId) ? withField : withoutField).push(c);
    const tagHist = (contacts: any[]) => {
      const counts: Record<string, number> = {};
      for (const c of contacts) {
        for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
    };
    const sourceHist = (contacts: any[]) => {
      const counts: Record<string, number> = {};
      for (const c of contacts) {
        const s = c.source || '(none)';
        counts[s] = (counts[s] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
    };
    const monthHist = (contacts: any[]) => {
      const counts: Record<string, number> = {};
      for (const c of contacts) {
        const m = c.dateAdded ? String(c.dateAdded).slice(0, 7) : '(none)';
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort();
    };
    const relatedFieldIds: Record<string, string> = {
      enrichment_score: 'OYKcSjyuA6SR1f662e81',
      lead_grade: '4y4wuwqboCHAthNaUw3N',
      score_label: '8zJs0yFDcSD65Zsqug5t',
      enrichment_source: '4ZZHt91KUeviHGT5V5rk',
    };
    const relatedPresence = (contacts: any[]) => {
      const out: Record<string, number> = {};
      for (const [k, id] of Object.entries(relatedFieldIds)) {
        out[k] = contacts.filter((c) => hasValue(c, id)).length;
      }
      return out;
    };
    res.json({
      success: true,
      total: all.length,
      withField: { count: withField.length, tags: tagHist(withField), sources: sourceHist(withField), byMonth: monthHist(withField), relatedFields: relatedPresence(withField) },
      withoutField: { count: withoutField.length, tags: tagHist(withoutField), sources: sourceHist(withoutField), byMonth: monthHist(withoutField), relatedFields: relatedPresence(withoutField), sampleIds: withoutField.slice(0, 5).map((c: any) => ({ id: c.id, email: c.email, dateAdded: c.dateAdded, source: c.source, tags: c.tags })) },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/custom-fields/migrate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const { fromFieldId, toFieldId, dryRun = true, limit } = req.body || {};
    if (!fromFieldId || !toFieldId) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'fromFieldId and toFieldId required' } });
    }
    const allContacts = await client.getAllContacts();
    const candidates = allContacts
      .map((c: any) => {
        const cf = (c.customFields || []).find((f: any) => f.id === fromFieldId);
        const srcValue = cf?.value != null ? String(cf.value).trim() : '';
        const existingTarget = (c.customFields || []).find((f: any) => f.id === toFieldId);
        const targetHasValue = existingTarget?.value != null && String(existingTarget.value).trim().length > 0;
        return { id: c.id, email: c.email, srcValue, targetHasValue };
      })
      .filter((x: any) => x.srcValue.length > 0 && !x.targetHasValue);
    const toProcess = limit ? candidates.slice(0, limit) : candidates;
    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        totalContacts: allContacts.length,
        candidatesWithSource: candidates.length,
        candidatesAlreadyHaveTarget: allContacts.filter((c: any) => (c.customFields || []).some((f: any) => f.id === toFieldId && String(f.value || '').trim().length > 0)).length,
        sampleFirst3: toProcess.slice(0, 3).map((x: any) => ({ id: x.id, email: x.email, srcPreview: x.srcValue.slice(0, 80) })),
      });
    }
    let migrated = 0;
    const errors: any[] = [];
    for (const c of toProcess) {
      try {
        await client.updateContact(c.id, { customFields: [{ id: toFieldId, value: c.srcValue }] });
        migrated++;
        await new Promise((r) => setTimeout(r, 150));
      } catch (err: any) {
        errors.push({ contactId: c.id, email: c.email, error: err?.message || 'unknown' });
      }
    }
    res.json({ success: true, dryRun: false, migrated, attempted: toProcess.length, errorCount: errors.length, errors: errors.slice(0, 10) });
  } catch (err) {
    next(err);
  }
});

router.post('/custom-fields', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const { name, dataType, placeholder, position, picklistOptions, textBoxListOptions, acceptedFormats, isMultipleFile, maxFileLimit } = req.body || {};
    if (!name || !dataType) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'name and dataType are required' } });
    }
    try {
      const created = await client.createCustomField({ name, dataType, placeholder, position, picklistOptions, textBoxListOptions, acceptedFormats, isMultipleFile, maxFileLimit });
      res.json({ success: true, customField: created });
    } catch (ghlErr: any) {
      const status = ghlErr?.response?.status || 500;
      const upstream = ghlErr?.response?.data || { message: ghlErr?.message || 'Unknown GHL error' };
      res.status(status).json({ success: false, error: { code: 'GHL_ERROR', status, upstream } });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/templates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type } = req.query;
    const client = ghlService.getClient(getCompanyId(req));
    if (!client) return res.json({ templates: [] });
    const data = await client.getTemplates(type as any);
    res.json({ templates: data });
  } catch (err) {
    next(err);
  }
});

// ── Location Info ───────────────────────────────────────────
router.get('/location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = requireClient(req);
    const data = await client.getLocationInfo();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
