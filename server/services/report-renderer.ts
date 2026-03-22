import { ReportData, ReportLead } from './report-data-service';

export function renderReportHtml(data: ReportData): string {
  const dateLabel = new Date(data.date).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const typeLabel = data.type === 'morning' ? 'Morning Recap' : 'Evening Summary';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Master Dashboard</h1>
            <p style="margin:8px 0 0;color:#a0aec0;font-size:14px;">Daily Meta Lead Report — ${typeLabel}</p>
            <p style="margin:4px 0 0;color:#718096;font-size:13px;">${dateLabel}</p>
          </td>
        </tr>

        <!-- Summary Banner -->
        <tr>
          <td style="padding:24px 40px;background:#f7fafc;border-bottom:1px solid #e2e8f0;">
            <p style="margin:0;font-size:15px;color:#2d3748;line-height:1.6;">${data.summary}</p>
          </td>
        </tr>

        ${renderMetaSection(data.meta)}
        ${renderLeadsSection(data.ghl)}
        ${renderEnrichmentSection(data.enrichment)}

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;background:#f7fafc;border-top:1px solid #e2e8f0;text-align:center;">
            <a href="http://localhost:5173/reports" style="display:inline-block;padding:10px 24px;background:#4299e1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">View Full Dashboard</a>
            <p style="margin:16px 0 0;color:#a0aec0;font-size:12px;">Master Dashboard — Automated Report</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderMetaSection(meta: ReportData['meta']): string {
  if (!meta) {
    return `
        <tr>
          <td style="padding:24px 40px;">
            <h2 style="margin:0 0 12px;font-size:16px;color:#2d3748;">Meta Ads Performance</h2>
            <p style="margin:0;color:#a0aec0;font-size:14px;font-style:italic;">Meta Ads API not configured — add META_ACCESS_TOKEN to enable this section.</p>
          </td>
        </tr>`;
  }

  return `
        <tr>
          <td style="padding:24px 40px;">
            <h2 style="margin:0 0 16px;font-size:16px;color:#2d3748;">Meta Ads Performance</h2>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                ${metricCell('Spend', `$${meta.spend.toFixed(2)}`)}
                ${metricCell('Impressions', meta.impressions.toLocaleString())}
                ${metricCell('Clicks', meta.clicks.toLocaleString())}
              </tr>
              <tr>
                ${metricCell('CTR', `${(meta.ctr * 100).toFixed(2)}%`)}
                ${metricCell('Leads', meta.leads.toString())}
                ${metricCell('CPL', meta.cpl > 0 ? `$${meta.cpl.toFixed(2)}` : '—')}
              </tr>
            </table>
            ${meta.campaigns.length > 0 ? renderCampaignTable(meta.campaigns) : ''}
          </td>
        </tr>`;
}

function metricCell(label: string, value: string): string {
  return `<td style="padding:8px 4px;text-align:center;width:33%;">
    <div style="background:#edf2f7;border-radius:6px;padding:12px 8px;">
      <div style="font-size:20px;font-weight:700;color:#2d3748;">${value}</div>
      <div style="font-size:12px;color:#718096;margin-top:4px;">${label}</div>
    </div>
  </td>`;
}

function renderCampaignTable(campaigns: Array<{ name: string; status: string; spend: number; leads: number }>): string {
  const rows = campaigns.map(c => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#4a5568;">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#48bb78;">${c.status}</td>
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
      <tr style="background:#edf2f7;">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Campaign</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Status</th>
      </tr>
      ${rows}
    </table>`;
}

function renderLeadsSection(ghl: ReportData['ghl']): string {
  if (ghl.totalCount === 0) {
    return `
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #e2e8f0;">
            <h2 style="margin:0 0 12px;font-size:16px;color:#2d3748;">New Meta Leads</h2>
            <p style="margin:0;color:#a0aec0;font-size:14px;">No new Meta leads for this period.</p>
          </td>
        </tr>`;
  }

  const gradeBreakdown = Object.entries(ghl.byGrade)
    .map(([g, count]) => `<span style="display:inline-block;padding:4px 10px;margin:2px 4px;background:${gradeColor(g)};border-radius:12px;font-size:12px;font-weight:600;color:#fff;">${g}: ${count}</span>`)
    .join('');

  const leadRows = ghl.newLeads.slice(0, 20).map((lead: ReportLead) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#2d3748;font-weight:500;">${lead.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:13px;color:#4a5568;">${lead.investorType}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;">
        <span style="padding:2px 8px;background:${gradeColor(lead.grade)};border-radius:10px;font-size:11px;font-weight:600;color:#fff;">${lead.grade}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #edf2f7;font-size:12px;color:#718096;">${formatTime(lead.dateAdded)}</td>
    </tr>`).join('');

  return `
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #e2e8f0;">
            <h2 style="margin:0 0 8px;font-size:16px;color:#2d3748;">New Meta Leads <span style="font-size:14px;color:#718096;font-weight:400;">(${ghl.totalCount})</span></h2>
            <div style="margin-bottom:16px;">${gradeBreakdown}</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
              <tr style="background:#edf2f7;">
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Name</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Investor Type</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Grade</th>
                <th style="padding:8px 12px;text-align:left;font-size:12px;color:#718096;font-weight:600;">Time</th>
              </tr>
              ${leadRows}
            </table>
            ${ghl.totalCount > 20 ? `<p style="margin:8px 0 0;font-size:12px;color:#a0aec0;">Showing 20 of ${ghl.totalCount} leads</p>` : ''}
          </td>
        </tr>`;
}

function renderEnrichmentSection(enrichment: ReportData['enrichment']): string {
  if (enrichment.total === 0) {
    return `
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #e2e8f0;">
            <h2 style="margin:0 0 12px;font-size:16px;color:#2d3748;">Enrichment Pipeline</h2>
            <p style="margin:0;color:#a0aec0;font-size:14px;">No enrichment activity for this period.</p>
          </td>
        </tr>`;
  }

  const statusBars = Object.entries(enrichment.byStatus).map(([status, count]) => {
    const pct = Math.round((count / enrichment.total) * 100);
    return `
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#4a5568;margin-bottom:2px;">
          <span>${capitalize(status)}</span><span>${count} (${pct}%)</span>
        </div>
        <div style="background:#edf2f7;border-radius:4px;height:8px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${statusColor(status)};border-radius:4px;"></div>
        </div>
      </div>`;
  }).join('');

  const scoreBadges = Object.entries(enrichment.byScore).map(([label, count]) =>
    `<span style="display:inline-block;padding:4px 10px;margin:2px;background:${scoreColor(label)};border-radius:12px;font-size:12px;font-weight:600;color:#fff;">${capitalize(label)}: ${count}</span>`
  ).join('');

  return `
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #e2e8f0;">
            <h2 style="margin:0 0 16px;font-size:16px;color:#2d3748;">Enrichment Pipeline <span style="font-size:14px;color:#718096;font-weight:400;">(${enrichment.total} leads)</span></h2>
            ${statusBars}
            ${scoreBadges ? `<div style="margin-top:12px;">${scoreBadges}</div>` : ''}
          </td>
        </tr>`;
}

function gradeColor(grade: string): string {
  const colors: Record<string, string> = { 'A+': '#38a169', 'A': '#4299e1', 'B': '#ed8936', 'Ungraded': '#a0aec0' };
  return colors[grade] || '#a0aec0';
}

function scoreColor(label: string): string {
  const colors: Record<string, string> = { hot: '#e53e3e', warm: '#ed8936', cold: '#4299e1' };
  return colors[label.toLowerCase()] || '#a0aec0';
}

function statusColor(status: string): string {
  const colors: Record<string, string> = { pending: '#ed8936', enriched: '#4299e1', scored: '#38a169', failed: '#e53e3e', pushed: '#805ad5' };
  return colors[status.toLowerCase()] || '#a0aec0';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch {
    return iso;
  }
}
