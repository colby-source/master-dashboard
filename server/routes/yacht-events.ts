/**
 * yacht-events.ts — Yacht mixer event management + guest check-in system.
 *
 * Public routes (no auth): /api/yacht-checkin/*
 * Admin routes (auth): /api/yacht-events/*
 */

import { Router } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../db';
import { ghlService } from '../services/ghl-service';
import { wsServer } from '../websocket/ws-server';
import QRCode from 'qrcode';

// ── Guest-Facing Check-In Page (serves HTML when QR is scanned) ──

export const yachtCheckinPageRouter = Router();

/** GET /yacht-checkin/:code — Serve the mobile check-in page */
yachtCheckinPageRouter.get('/:code', (req, res) => {
  const code = req.params.code;
  const apiBase = `${req.protocol}://${req.get('host')}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <title>Check In — Granite Park Capital</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@300;400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%);
      min-height: 100vh; display: flex; flex-direction: column;
      align-items: center; padding: 20px;
      color: #ffffff;
    }
    .container { width: 100%; max-width: 420px; margin: auto; }
    .card {
      background: rgba(255,255,255,0.06);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 24px; padding: 36px 28px;
      text-align: center;
    }
    .brand {
      font-family: 'Playfair Display', serif;
      font-size: 22px; letter-spacing: 2px; color: #fff;
      margin-bottom: 4px;
    }
    .brand-sub {
      font-size: 11px; letter-spacing: 3px; text-transform: uppercase;
      color: #d4a574; margin-bottom: 24px;
    }
    .event-name { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
    .event-meta {
      font-size: 14px; color: rgba(255,255,255,0.6); line-height: 1.5;
      margin-bottom: 20px;
    }
    .yacht-badge {
      display: inline-block; padding: 4px 14px; border-radius: 20px;
      background: rgba(212,165,116,0.15); color: #d4a574;
      font-size: 11px; font-weight: 600; letter-spacing: 2px;
      margin-bottom: 24px;
    }
    .divider {
      height: 1px; background: rgba(255,255,255,0.1);
      margin: 0 -28px 24px;
    }
    .form-row { margin-bottom: 14px; text-align: left; }
    .form-row label {
      display: block; font-size: 12px; font-weight: 500;
      color: rgba(255,255,255,0.6); margin-bottom: 6px; letter-spacing: 0.5px;
    }
    .form-row-double { display: flex; gap: 10px; }
    .form-row-double .form-row { flex: 1; margin-bottom: 0; }
    input[type="text"], input[type="email"], input[type="tel"] {
      width: 100%; padding: 13px 14px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.08); color: #fff;
      font-size: 16px; font-family: 'Inter', sans-serif;
      outline: none; transition: border-color 0.2s;
      -webkit-appearance: none;
    }
    select {
      width: 100%; padding: 13px 14px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.08); color: #fff;
      font-size: 16px; font-family: 'Inter', sans-serif;
      outline: none; transition: border-color 0.2s;
    }
    input::placeholder { color: rgba(255,255,255,0.3); }
    select option { background: #1a1a3e; color: #fff; }
    .validation-msg {
      color: #ef4444; font-size: 12px; text-align: center;
      margin-top: 8px; display: none;
    }
    .validation-msg.show { display: block; }
    input:focus, select:focus { border-color: #d4a574; }
    .input-error { border-color: #ef4444 !important; }
    .rules-section {
      background: rgba(255,255,255,0.04); border-radius: 16px;
      padding: 20px; margin: 20px 0; text-align: left;
    }
    .rules-title {
      font-size: 14px; font-weight: 600; color: #d4a574;
      margin-bottom: 12px; letter-spacing: 0.5px;
    }
    .rules-list {
      list-style: none; padding: 0;
    }
    .rules-list li {
      font-size: 13px; color: rgba(255,255,255,0.75); line-height: 1.5;
      padding: 6px 0; padding-left: 20px; position: relative;
    }
    .rules-list li::before {
      content: ''; position: absolute; left: 0; top: 12px;
      width: 6px; height: 6px; border-radius: 50%;
      background: #d4a574;
    }
    .checkbox-row {
      display: flex; align-items: flex-start; gap: 10px;
      margin-top: 16px; text-align: left;
    }
    .checkbox-row input[type="checkbox"] {
      width: 20px; height: 20px; margin-top: 2px; flex-shrink: 0;
      accent-color: #d4a574; cursor: pointer;
    }
    .checkbox-row label {
      font-size: 13px; color: rgba(255,255,255,0.7); cursor: pointer;
      line-height: 1.4;
    }
    .btn {
      width: 100%; padding: 16px; border: none; border-radius: 12px;
      background: linear-gradient(135deg, #d4a574, #c4915e);
      color: #0f0f23; font-size: 16px; font-weight: 600;
      font-family: 'Inter', sans-serif; cursor: pointer;
      margin-top: 16px; transition: opacity 0.2s;
      letter-spacing: 0.5px;
    }
    .btn:active { opacity: 0.85; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { display: none; margin-top: 24px; padding: 24px; border-radius: 16px; }
    .status.success {
      display: block; background: rgba(34,197,94,0.12);
      border: 1px solid rgba(34,197,94,0.3);
    }
    .status.error {
      display: block; background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.3);
    }
    .status.already {
      display: block; background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.3);
    }
    .status-icon { font-size: 48px; margin-bottom: 12px; }
    .status-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .status-msg { font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.5; }
    .status-detail { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 10px; }
    .guest-info { font-size: 14px; color: rgba(255,255,255,0.6); margin-top: 12px; font-weight: 500; }
    .confirmation-card {
      background: rgba(255,255,255,0.08); border-radius: 16px;
      padding: 20px; margin-top: 16px; text-align: left;
    }
    .confirmation-card .conf-label {
      font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase;
      letter-spacing: 1px; margin-bottom: 4px;
    }
    .confirmation-card .conf-value {
      font-size: 14px; color: rgba(255,255,255,0.8); margin-bottom: 12px;
    }
    .confirmation-card .conf-value:last-child { margin-bottom: 0; }
    .show-checkin-tag {
      display: inline-block; margin-top: 16px; padding: 8px 20px;
      border-radius: 20px; background: rgba(34,197,94,0.2);
      border: 1px solid rgba(34,197,94,0.4);
      font-size: 13px; font-weight: 600; color: #22c55e;
      letter-spacing: 0.5px;
    }
    .form-section { transition: opacity 0.3s; }
    .form-section.hidden { opacity: 0; pointer-events: none; height: 0; overflow: hidden; }
    .loading { display: none; text-align: center; padding: 20px; }
    .loading.show { display: block; }
    .spinner {
      width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1);
      border-top-color: #d4a574; border-radius: 50%;
      animation: spin 0.8s linear infinite; margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .event-loading { padding: 60px 20px; text-align: center; }
    .error-page { text-align: center; padding: 40px 20px; }
    .error-page h2 { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card" id="card">
      <div class="event-loading" id="eventLoading">
        <div class="spinner"></div>
        <div style="color:rgba(255,255,255,0.5); font-size:14px;">Loading event...</div>
      </div>

      <div id="eventContent" style="display:none;">
        <div class="brand">GRANITE PARK CAPITAL</div>
        <div class="brand-sub">Private Investor Event</div>
        <div class="event-name" id="eventName"></div>
        <div class="event-meta" id="eventMeta"></div>
        <div class="yacht-badge" id="yachtBadge"></div>
        <div class="divider"></div>

        <div class="form-section" id="formSection">
          <div class="form-row-double">
            <div class="form-row">
              <label>First Name *</label>
              <input type="text" id="firstName" placeholder="First" autocomplete="given-name">
            </div>
            <div class="form-row">
              <label>Last Name *</label>
              <input type="text" id="lastName" placeholder="Last" autocomplete="family-name">
            </div>
          </div>
          <div style="height:14px;"></div>
          <div class="form-row">
            <label>Email *</label>
            <input type="email" id="email" placeholder="your@email.com" autocomplete="email" autocapitalize="off" inputmode="email">
          </div>
          <div class="form-row">
            <label>Phone *</label>
            <input type="tel" id="phone" placeholder="(555) 555-5555" autocomplete="tel" inputmode="tel">
          </div>
          <div class="form-row">
            <label>Company</label>
            <input type="text" id="company" placeholder="Company name" autocomplete="organization">
          </div>
          <div class="form-row">
            <label>Investor Type *</label>
            <select id="investorType">
              <option value="" disabled selected>Select investor type</option>
              <option value="Accredited Investor">Accredited Investor</option>
              <option value="Qualified Purchaser">Qualified Purchaser</option>
              <option value="Institutional Investor">Institutional Investor</option>
              <option value="Family Office">Family Office</option>
              <option value="Registered Investment Advisor">Registered Investment Advisor</option>
              <option value="Broker Dealer">Broker Dealer</option>
              <option value="Fund Manager">Fund Manager</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div class="rules-section">
            <div class="rules-title">YACHT BOARDING RULES</div>
            <ul class="rules-list">
              <li>No shoes on the yacht</li>
              <li>No outside food or beverages on board</li>
              <li>No smoking or vaping on the yacht</li>
              <li>Photography and video are welcome — please respect other guests' privacy</li>
              <li>Children under 18 are not permitted at this event</li>
              <li>Granite Park Capital and affiliates are not liable for personal injury or loss of property</li>
            </ul>
            <div class="checkbox-row">
              <input type="checkbox" id="rulesAccepted">
              <label for="rulesAccepted">I have read, understand, and agree to the above rules and acknowledge the liability waiver.</label>
            </div>
          </div>

          <div class="validation-msg" id="validationMsg">Please fill in all required fields and accept the rules.</div>
          <button class="btn" id="checkinBtn" onclick="doCheckin()">Confirm & Board</button>
        </div>

        <div class="loading" id="loadingIndicator">
          <div class="spinner"></div>
          <div style="color:rgba(255,255,255,0.5); font-size:14px;">Registering you...</div>
        </div>

        <div id="statusBox" class="status"></div>
      </div>

      <div id="errorPage" class="error-page" style="display:none;">
        <div style="font-size:36px; margin-bottom:16px;"></div>
        <h2 id="errorTitle">Event Not Found</h2>
        <div class="status-msg" id="errorMsg">This check-in link may be invalid or expired.</div>
      </div>
    </div>
  </div>

  <script>
    const API = '/api/yacht-checkin/${code}';
    const formSection = document.getElementById('formSection');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const statusBox = document.getElementById('statusBox');

    // Load event info
    fetch(API)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          document.getElementById('eventLoading').style.display = 'none';
          document.getElementById('errorPage').style.display = 'block';
          document.getElementById('errorMsg').textContent = data.error;
          return;
        }
        const e = data.event;
        const date = new Date(e.date + 'T12:00:00');
        const formatted = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        document.getElementById('eventName').textContent = e.name;
        document.getElementById('eventMeta').innerHTML = formatted + '<br>' + e.location;
        document.getElementById('yachtBadge').textContent = 'YACHT ' + e.yacht + ' — PRIVATE EVENT';
        document.getElementById('eventLoading').style.display = 'none';
        document.getElementById('eventContent').style.display = 'block';
        document.getElementById('firstName').focus();
      })
      .catch(() => {
        document.getElementById('eventLoading').style.display = 'none';
        document.getElementById('errorPage').style.display = 'block';
        document.getElementById('errorMsg').textContent = 'Unable to load event. Check your connection.';
      });

    function doCheckin() {
      // Clear previous errors
      document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

      const firstName = document.getElementById('firstName').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const email = document.getElementById('email').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const company = document.getElementById('company').value.trim();
      const investorType = document.getElementById('investorType').value;
      const rulesAccepted = document.getElementById('rulesAccepted').checked;

      // Validate required fields
      const vMsg = document.getElementById('validationMsg');
      vMsg.classList.remove('show');
      let valid = true;
      let firstBad = null;
      function markBad(id) { const el = document.getElementById(id); el.classList.add('input-error'); if (!firstBad) firstBad = el; valid = false; }
      if (!firstName) markBad('firstName');
      if (!lastName) markBad('lastName');
      if (!email || !email.includes('@')) markBad('email');
      if (!phone) markBad('phone');
      if (!investorType) markBad('investorType');
      if (!rulesAccepted) {
        document.getElementById('rulesAccepted').style.outline = '2px solid #ef4444';
        if (!firstBad) firstBad = document.getElementById('rulesAccepted');
        valid = false;
      }
      if (!valid) {
        vMsg.classList.add('show');
        if (firstBad) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      formSection.classList.add('hidden');
      loadingIndicator.classList.add('show');
      statusBox.className = 'status';
      statusBox.innerHTML = '';

      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, phone, company, investorType, rulesAccepted: true }),
      })
        .then(function(r) {
          if (!r.ok) {
            return r.json().catch(function() { return { error: 'Server error (' + r.status + ')' }; });
          }
          return r.json();
        })
        .then(data => {
          loadingIndicator.classList.remove('show');
          if (data.approved) {
            const a = data.attendee;
            const guestEmail = a.email || email;
            statusBox.className = data.alreadyCheckedIn ? 'status already' : 'status success';
            statusBox.innerHTML =
              '<div class="status-icon">' + (data.alreadyCheckedIn ? '\\u2705' : '\\u2709\\uFE0F') + '</div>' +
              '<div class="status-title">' + (data.alreadyCheckedIn ? 'Welcome Back, ' + (a.firstName || '') + '!' : 'You\\'re Almost There!') + '</div>' +
              '<div class="status-msg" style="font-size:16px; margin: 12px 0;">' +
                (data.alreadyCheckedIn
                  ? 'You are already registered. Show your confirmation email to the check-in attendant.'
                  : 'A <strong>confirmation email</strong> has been sent to:') +
              '</div>' +
              (data.alreadyCheckedIn ? '' : '<div style="background:rgba(255,255,255,0.1); border-radius:10px; padding:12px 16px; margin:12px 0; font-size:17px; font-weight:600; color:#c9a96e; letter-spacing:0.5px;">' + guestEmail + '</div>') +
              '<div class="confirmation-card">' +
                '<div class="conf-label">Guest</div>' +
                '<div class="conf-value">' + (a.firstName || '') + ' ' + (a.lastName || '') + '</div>' +
                (a.company ? '<div class="conf-label">Company</div><div class="conf-value">' + a.company + '</div>' : '') +
                '<div class="conf-label">Investor Type</div>' +
                '<div class="conf-value">' + (a.investorType || '') + '</div>' +
              '</div>' +
              '<div class="show-checkin-tag" style="background:rgba(201,169,110,0.15); border:1px solid rgba(201,169,110,0.3); border-radius:10px; padding:16px; margin-top:16px; text-align:center;">' +
                '<div style="font-size:14px; font-weight:600; color:#c9a96e; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">\\u{1F4E9} Check Your Inbox</div>' +
                '<div style="font-size:13px; color:rgba(255,255,255,0.7);">Open the confirmation email and show it to the check-in attendant to board the yacht.</div>' +
              '</div>';
          } else {
            var errMsg = data.message || data.error || 'Something went wrong. Please try again.';
            if (typeof errMsg === 'object') errMsg = errMsg.message || JSON.stringify(errMsg);
            statusBox.className = 'status error';
            statusBox.innerHTML =
              '<div class="status-icon">\\u26D4</div>' +
              '<div class="status-title">Registration Issue</div>' +
              '<div class="status-msg">' + errMsg + '</div>';
            setTimeout(() => {
              formSection.classList.remove('hidden');
            }, 3000);
          }
        })
        .catch(function(e) {
          loadingIndicator.classList.remove('show');
          statusBox.className = 'status error';
          statusBox.innerHTML =
            '<div class="status-icon">\\u26A0\\uFE0F</div>' +
            '<div class="status-title">Connection Error</div>' +
            '<div class="status-msg">' + (e && e.message ? e.message : 'Please check your connection and try again.') + '</div>';
          formSection.classList.remove('hidden');
        });
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});


// ── Public Check-In API Routes (no auth, guests scan QR) ─────────────

export const yachtCheckinRouter = Router();

/** GET /api/yacht-checkin/:code — Get event info for check-in page */
yachtCheckinRouter.get('/:code', (req, res) => {
  try {
    const event = queryOne(
      `SELECT id, name, event_date, location, yacht_name, status FROM yacht_events WHERE check_in_code = ?`,
      [req.params.code]
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status === 'cancelled') {
      return res.status(410).json({ error: 'This event has been cancelled' });
    }

    if (event.status === 'completed') {
      return res.status(410).json({ error: 'This event has ended' });
    }

    const checkedInCount = queryOne(
      `SELECT COUNT(*) as count FROM yacht_event_attendees WHERE event_id = ? AND status = 'checked_in'`,
      [event.id]
    );

    res.json({
      event: {
        name: event.name,
        date: event.event_date,
        location: event.location,
        yacht: event.yacht_name,
        status: event.status,
      },
      checkedIn: checkedInCount?.count || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-checkin/:code — Guest registers & checks in via QR form */
yachtCheckinRouter.post('/:code', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company, investorType, rulesAccepted } = req.body;
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Find the event
    const event = queryOne(
      `SELECT * FROM yacht_events WHERE check_in_code = ?`,
      [req.params.code]
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status === 'cancelled' || event.status === 'completed') {
      return res.status(410).json({ error: 'This event is no longer active' });
    }

    // Check if already registered
    let attendee = queryOne(
      `SELECT * FROM yacht_event_attendees WHERE event_id = ? AND LOWER(email) = ?`,
      [event.id, normalizedEmail]
    );

    if (attendee && attendee.status === 'checked_in') {
      return res.json({
        approved: true,
        alreadyCheckedIn: true,
        attendee: {
          firstName: attendee.first_name,
          lastName: attendee.last_name,
          company: attendee.company,
          investorType: attendee.investor_type,
          email: attendee.email,
          vip: attendee.vip_flag === 1,
        },
        message: `Welcome back, ${attendee.first_name}! You're already checked in.`,
      });
    }

    const now = new Date().toISOString();

    if (attendee) {
      // Update existing attendee record with new info and check them in
      runSql(
        `UPDATE yacht_event_attendees
         SET first_name = ?, last_name = ?, phone = ?, company = ?, investor_type = ?,
             rules_accepted = 1, status = 'checked_in', checked_in_at = ?
         WHERE id = ?`,
        [firstName.trim(), lastName.trim(), phone?.trim() || null, company?.trim() || null, investorType || null, now, attendee.id]
      );
    } else {
      // Auto-register: create new attendee and immediately check them in
      runSql(
        `INSERT INTO yacht_event_attendees (event_id, email, first_name, last_name, phone, company, investor_type, rules_accepted, status, checked_in_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'checked_in', ?)`,
        [event.id, normalizedEmail, firstName.trim(), lastName.trim(), phone?.trim() || null, company?.trim() || null, investorType || null, now]
      );
    }
    saveDb();

    // Re-fetch the attendee record
    attendee = queryOne(
      `SELECT * FROM yacht_event_attendees WHERE event_id = ? AND LOWER(email) = ?`,
      [event.id, normalizedEmail]
    );

    // Async: Tag in GHL, move opportunity, send confirmation email (non-blocking)
    processCheckinAsync(event, attendee).catch(err => {
      console.error('[YachtCheckin] Async GHL processing error:', err.message);
    });

    // Broadcast to dashboard
    wsServer.broadcast({
      type: 'yacht_checkin',
      eventId: event.id,
      attendee: {
        id: attendee.id,
        firstName: attendee.first_name,
        lastName: attendee.last_name,
        email: attendee.email,
        company: attendee.company,
        investorType: attendee.investor_type,
        vip: attendee.vip_flag === 1,
      },
    });

    res.json({
      approved: true,
      alreadyCheckedIn: false,
      attendee: {
        firstName: attendee.first_name,
        lastName: attendee.last_name,
        company: attendee.company,
        investorType: attendee.investor_type,
        email: attendee.email,
        vip: attendee.vip_flag === 1,
      },
      message: `Welcome aboard, ${attendee.first_name}! You're confirmed for ${event.name}.`,
    });
  } catch (err: any) {
    console.error('[YachtCheckin] Check-in error:', err.message);
    res.status(500).json({ error: 'Check-in failed. Please try again or speak with the event coordinator.' });
  }
});

/**
 * After check-in: tag in GHL, find/move in opportunity, start appropriate sequence.
 */
async function processCheckinAsync(event: any, attendee: any): Promise<void> {
  const companyId = 1; // Grand Park Capital
  const ghlClient = ghlService.getClient(companyId);
  if (!ghlClient) return;

  try {
    let contactId = attendee.ghl_contact_id;

    // Find or create GHL contact
    if (!contactId) {
      const searchResult = await ghlClient.searchContacts(attendee.email);
      if (searchResult && searchResult.length > 0) {
        contactId = searchResult[0].id;
        // Save GHL contact ID back to attendee record
        runSql(`UPDATE yacht_event_attendees SET ghl_contact_id = ? WHERE id = ?`, [contactId, attendee.id]);
        saveDb();
      }
    }

    if (!contactId) {
      // Create contact in GHL
      const newContact = await ghlClient.createContact({
        email: attendee.email,
        firstName: attendee.first_name,
        lastName: attendee.last_name,
        phone: attendee.phone,
        companyName: attendee.company,
      });
      if (newContact?.id) {
        contactId = newContact.id;
        runSql(`UPDATE yacht_event_attendees SET ghl_contact_id = ? WHERE id = ?`, [contactId, attendee.id]);
        saveDb();
      }
    }

    if (!contactId) return;

    // Add tags
    const eventTag = `yacht-event-${event.event_date}`;
    const tags = ['yacht-attendee', 'event-checked-in', 'attended-mixer', eventTag];
    if (attendee.vip_flag) tags.push('vip');

    const tagResult = await ghlClient.addContactTags(contactId, tags).catch((err: any) => {
      console.error(`[YachtCheckin] Failed to tag contact ${contactId}:`, err.message);
      return null;
    });
    console.log(`[YachtCheckin] Tagged contact ${contactId} with [${tags.join(', ')}]:`, tagResult ? 'SUCCESS' : 'FAILED');

    // Create note
    await ghlClient.createContactNote(
      contactId,
      `Checked in to yacht event: ${event.name} on ${event.event_date} at ${event.location} (${event.yacht_name}). Checked in at: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`
    ).catch(() => {});

    // Move opportunity if exists — look for pipeline with "yacht" or "event" in stage name
    const pipelinesResult = await ghlClient.getPipelines().catch(() => ({ pipelines: [] }));
    const pipelines = pipelinesResult?.pipelines || [];
    if (pipelines.length > 0) {
      for (const pipeline of pipelines) {
        const oppsResult = await ghlClient.getOpportunities(pipeline.id).catch(() => ({ opportunities: [] }));
        const opportunities = oppsResult?.opportunities || [];
        if (!opportunities.length) continue;
        const match = opportunities.find((opp: any) =>
          opp.contact?.id === contactId || opp.contact?.email?.toLowerCase() === attendee.email.toLowerCase()
        );
        if (match) {
          // Tag the opportunity as "attended mixer"
          const existingTags = match.tags || [];
          const updatedTags = [...new Set([...existingTags, 'attended-mixer', eventTag])];
          const oppTagResult = await ghlClient.updateOpportunity(match.id, { tags: updatedTags }).catch((err: any) => {
            console.error(`[YachtCheckin] Failed to tag opportunity ${match.id}:`, err.message);
            return null;
          });
          console.log(`[YachtCheckin] Tagged opportunity ${match.id} with attended-mixer:`, oppTagResult ? 'SUCCESS' : 'FAILED');

          // Move to "attended" stage if one exists
          const stages = pipeline.stages || [];
          const attendedStage = stages.find((s: any) =>
            s.name?.toLowerCase().includes('attend') ||
            s.name?.toLowerCase().includes('mixer') ||
            s.name?.toLowerCase().includes('met') ||
            s.name?.toLowerCase().includes('meeting')
          );
          if (attendedStage) {
            const stageResult = await ghlClient.updateOpportunityStage(match.id, attendedStage.id).catch((err: any) => {
              console.error(`[YachtCheckin] Failed to move opportunity to stage ${attendedStage.name}:`, err.message);
              return null;
            });
            console.log(`[YachtCheckin] Moved opportunity ${match.id} to stage "${attendedStage.name}":`, stageResult ? 'SUCCESS' : 'FAILED');
          }
          break;
        }
      }
    }

    // Send confirmation email via GHL
    if (contactId) {
      const eventDate = new Date(event.event_date + 'T12:00:00');
      const dateFormatted = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const confirmationHtml = `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #1a1a2e, #2d2d5e); padding: 40px 32px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="font-family: Georgia, serif; font-size: 28px; color: #ffffff; letter-spacing: 2px; margin: 0 0 4px;">GRANITE PARK CAPITAL</h1>
            <p style="font-size: 12px; letter-spacing: 3px; color: #d4a574; margin: 0; text-transform: uppercase;">Private Investor Event</p>
          </div>
          <div style="padding: 40px 32px; border: 1px solid #e5e7eb; border-top: none;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="font-size: 48px; margin-bottom: 12px;">&#x1F6F3;</div>
              <h2 style="font-size: 24px; color: #1a1a2e; margin: 0 0 8px;">Congratulations, ${attendee.first_name}!</h2>
              <p style="font-size: 16px; color: #6b7280; margin: 0;">You are cleared to board <strong>The Granite Park Yacht</strong></p>
            </div>
            <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Event</td></tr>
                <tr><td style="padding: 0 0 16px; font-size: 16px; color: #1a1a2e; font-weight: 600;">${event.name}</td></tr>
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Date</td></tr>
                <tr><td style="padding: 0 0 16px; font-size: 15px; color: #374151;">${dateFormatted}</td></tr>
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Venue</td></tr>
                <tr><td style="padding: 0 0 16px; font-size: 15px; color: #374151;">${event.location}</td></tr>
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Yacht</td></tr>
                <tr><td style="padding: 0 0 16px; font-size: 15px; color: #374151;">${event.yacht_name}</td></tr>
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Guest</td></tr>
                <tr><td style="padding: 0 0 16px; font-size: 15px; color: #374151;">${attendee.first_name} ${attendee.last_name}${attendee.company ? ' — ' + attendee.company : ''}</td></tr>
                <tr><td style="padding: 8px 0; font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;">Status</td></tr>
                <tr><td style="padding: 0; font-size: 15px; color: #22c55e; font-weight: 700;">&#x2705; BOARDING APPROVED</td></tr>
              </table>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <h3 style="font-size: 14px; color: #d4a574; margin: 0 0 12px; letter-spacing: 0.5px;">BOARDING REMINDERS</h3>
              <ul style="margin: 0; padding-left: 20px; color: #6b7280; font-size: 13px; line-height: 2;">
                <li>No shoes on the yacht</li>
                <li>No outside food or beverages</li>
                <li>No smoking or vaping on the yacht</li>
              </ul>
            </div>
            <div style="background: #1a1a2e; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 16px;">
              <p style="font-size: 16px; color: #c9a96e; font-weight: 700; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">&#x{1F4F1} SHOW THIS EMAIL AT CHECK-IN</p>
              <p style="font-size: 13px; color: rgba(255,255,255,0.7); margin: 0;">Present this email to the check-in attendant to board the yacht.</p>
            </div>
            <p style="font-size: 14px; color: #9ca3af; text-align: center; line-height: 1.6;">
              We look forward to seeing you aboard!
            </p>
          </div>
          <div style="text-align: center; padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">Granite Park Capital | Private Investor Events</p>
          </div>
        </div>`;

      await ghlClient.sendMessage({
        contactId,
        type: 'Email',
        subject: `You're Cleared to Board — ${event.name}`,
        html: confirmationHtml,
      }).catch((err: any) => {
        console.error(`[YachtCheckin] Confirmation email error for ${attendee.email}:`, err.message);
      });
      console.log(`[YachtCheckin] Confirmation email sent to ${attendee.email}`);
    }

    // Update enrichment lead if linked
    if (attendee.enrichment_lead_id) {
      runSql(
        `UPDATE enrichment_leads SET status = 'meeting_set' WHERE id = ? AND status != 'meeting_set'`,
        [attendee.enrichment_lead_id]
      );
      runSql(
        `INSERT INTO enrichment_events (enrichment_lead_id, company_id, event_type, event_data) VALUES (?, ?, 'yacht_checkin', ?)`,
        [attendee.enrichment_lead_id, companyId, JSON.stringify({
          eventId: event.id,
          eventName: event.name,
          eventDate: event.event_date,
          checkedInAt: new Date().toISOString(),
        })]
      );
      saveDb();
    }

    console.log(`[YachtCheckin] GHL sync complete for ${attendee.email}`);
  } catch (err: any) {
    console.error(`[YachtCheckin] GHL sync error for ${attendee.email}:`, err.message);
  }
}


// ── Admin Routes (behind auth) ───────────────────────────────────

export const yachtEventsRouter = Router();

/** GET /api/yacht-events — List all events */
yachtEventsRouter.get('/', (req, res) => {
  try {
    const events = queryAll(`SELECT * FROM yacht_events ORDER BY event_date DESC`);
    // Add attendee counts
    const enriched = events.map((e: any) => {
      const counts = queryOne(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END) as checked_in,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'invited' THEN 1 ELSE 0 END) as invited
        FROM yacht_event_attendees WHERE event_id = ?`,
        [e.id]
      );
      return { ...e, attendeeCounts: counts };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events — Create a new event */
yachtEventsRouter.post('/', (req, res) => {
  try {
    const { name, eventDate, location, yachtName, maxCapacity, notes } = req.body;
    if (!name || !eventDate) {
      return res.status(400).json({ error: 'name and eventDate required' });
    }

    const checkInCode = `yacht-${eventDate}`;

    // Check for duplicate code
    const existing = queryOne(`SELECT id FROM yacht_events WHERE check_in_code = ?`, [checkInCode]);
    if (existing) {
      return res.status(409).json({ error: `Event already exists for ${eventDate}` });
    }

    runSql(
      `INSERT INTO yacht_events (name, event_date, location, yacht_name, max_capacity, check_in_code, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        eventDate,
        location || 'The Deck at Island Gardens, Miami',
        yachtName || 'TYCOON',
        maxCapacity || 50,
        checkInCode,
        notes || null,
      ]
    );
    saveDb();

    const event = queryOne(`SELECT * FROM yacht_events WHERE check_in_code = ?`, [checkInCode]);
    res.status(201).json(event);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id — Get event with attendees */
yachtEventsRouter.get('/:id', (req, res) => {
  try {
    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const attendees = queryAll(
      `SELECT * FROM yacht_event_attendees WHERE event_id = ? ORDER BY
        CASE status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'invited' THEN 2 ELSE 3 END,
        last_name ASC`,
      [event.id]
    );

    res.json({ ...event, attendees });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/yacht-events/:id — Update event */
yachtEventsRouter.put('/:id', (req, res) => {
  try {
    const { name, eventDate, location, yachtName, maxCapacity, status, notes } = req.body;
    const updates: string[] = [];
    const values: any[] = [];

    if (name) { updates.push('name = ?'); values.push(name); }
    if (eventDate) { updates.push('event_date = ?'); values.push(eventDate); }
    if (location) { updates.push('location = ?'); values.push(location); }
    if (yachtName) { updates.push('yacht_name = ?'); values.push(yachtName); }
    if (maxCapacity) { updates.push('max_capacity = ?'); values.push(maxCapacity); }
    if (status) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    updates.push("updated_at = datetime('now')");

    if (updates.length === 1) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    runSql(`UPDATE yacht_events SET ${updates.join(', ')} WHERE id = ?`, values);
    saveDb();

    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [req.params.id]);
    res.json(event);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events/:id/attendees — Add attendees (single or bulk) */
yachtEventsRouter.post('/:id/attendees', (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const attendees: any[] = Array.isArray(req.body) ? req.body : [req.body];
    let added = 0;
    let skipped = 0;

    for (const a of attendees) {
      if (!a.email) { skipped++; continue; }

      const email = a.email.trim().toLowerCase();
      const existing = queryOne(
        `SELECT id FROM yacht_event_attendees WHERE event_id = ? AND LOWER(email) = ?`,
        [eventId, email]
      );

      if (existing) {
        skipped++;
        continue;
      }

      runSql(
        `INSERT INTO yacht_event_attendees (event_id, email, first_name, last_name, phone, company, ghl_contact_id, enrichment_lead_id, status, vip_flag, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          email,
          a.firstName || a.first_name || null,
          a.lastName || a.last_name || null,
          a.phone || null,
          a.company || null,
          a.ghlContactId || a.ghl_contact_id || null,
          a.enrichmentLeadId || a.enrichment_lead_id || null,
          a.status || 'invited',
          a.vip ? 1 : 0,
          a.notes || null,
        ]
      );
      added++;
    }

    saveDb();
    res.json({ added, skipped, total: added + skipped });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/yacht-events/:id/attendees/:attendeeId — Remove attendee */
yachtEventsRouter.delete('/:id/attendees/:attendeeId', (req, res) => {
  try {
    runSql(`DELETE FROM yacht_event_attendees WHERE id = ? AND event_id = ?`, [req.params.attendeeId, req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/yacht-events/:id/import-ghl — Import attendees from GHL by tag */
yachtEventsRouter.post('/:id/import-ghl', async (req, res) => {
  try {
    const eventId = parseInt(req.params.id);
    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [eventId]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const tag = req.body.tag || 'approved for event';
    const companyId = req.body.companyId || 1; // Default to Grand Park Capital

    const ghlClient = ghlService.getClient(companyId);
    if (!ghlClient) {
      return res.status(500).json({ error: 'GHL client not available' });
    }

    // Search for contacts with the specified tag
    const result = await ghlClient.searchContacts(undefined, 100, tag);
    const contacts = result?.contacts || [];

    if (contacts.length === 0) {
      return res.json({ added: 0, skipped: 0, total: 0, message: `No contacts found with tag "${tag}"` });
    }

    let added = 0;
    let skipped = 0;

    for (const c of contacts) {
      const email = (c.email || '').trim().toLowerCase();
      if (!email) { skipped++; continue; }

      const existing = queryOne(
        `SELECT id FROM yacht_event_attendees WHERE event_id = ? AND LOWER(email) = ?`,
        [eventId, email]
      );

      if (existing) {
        // Update GHL contact ID if missing
        const attendee = queryOne(`SELECT ghl_contact_id FROM yacht_event_attendees WHERE id = ?`, [existing.id]);
        if (!attendee?.ghl_contact_id) {
          runSql(`UPDATE yacht_event_attendees SET ghl_contact_id = ? WHERE id = ?`, [c.id, existing.id]);
        }
        skipped++;
        continue;
      }

      runSql(
        `INSERT INTO yacht_event_attendees (event_id, email, first_name, last_name, phone, company, ghl_contact_id, status, vip_flag)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 0)`,
        [
          eventId,
          email,
          c.firstName || c.first_name || null,
          c.lastName || c.last_name || null,
          c.phone || null,
          c.companyName || c.company || null,
          c.id,
        ]
      );
      added++;
    }

    saveDb();

    console.log(`[YachtEvents] Imported ${added} attendees from GHL tag "${tag}" for event ${eventId} (${skipped} skipped)`);
    res.json({
      added,
      skipped,
      total: contacts.length,
      message: `Imported ${added} attendees from GHL (${skipped} already existed)`,
    });
  } catch (err: any) {
    console.error('[YachtEvents] GHL import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id/qr — Generate QR code for event */
yachtEventsRouter.get('/:id/qr', async (req, res) => {
  try {
    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Use custom base URL if provided, otherwise use request origin
    const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}`;
    const checkinUrl = `${baseUrl}/yacht-checkin/${event.check_in_code}`;

    const format = req.query.format || 'png';

    if (format === 'svg') {
      const svg = await QRCode.toString(checkinUrl, {
        type: 'svg',
        width: 400,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } else {
      const png = await QRCode.toBuffer(checkinUrl, {
        width: 800,
        margin: 2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'H', // High error correction for printing
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="yacht-checkin-${event.check_in_code}.png"`);
      res.send(png);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/yacht-events/:id/qr-page — Generate printable QR code page (HTML) */
yachtEventsRouter.get('/:id/qr-page', async (req, res) => {
  try {
    const event = queryOne(`SELECT * FROM yacht_events WHERE id = ?`, [req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}`;
    const checkinUrl = `${baseUrl}/yacht-checkin/${event.check_in_code}`;

    const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
      width: 600,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    });

    const eventDateFormatted = new Date(event.event_date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Check-In — ${event.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh; background: #f8f9fa;
    }
    .card {
      background: white; border-radius: 24px; padding: 60px 48px;
      text-align: center; max-width: 520px; width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .logo-text {
      font-family: 'Playfair Display', serif;
      font-size: 28px; color: #1a1a2e; letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .subtitle { font-size: 13px; color: #6b7280; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 32px; }
    .event-name { font-size: 22px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; }
    .event-details { font-size: 15px; color: #6b7280; margin-bottom: 32px; line-height: 1.6; }
    .qr-container { margin: 0 auto 32px; }
    .qr-container img { width: 280px; height: 280px; border-radius: 12px; }
    .instructions { font-size: 16px; font-weight: 500; color: #1a1a2e; margin-bottom: 8px; }
    .instructions-sub { font-size: 13px; color: #9ca3af; }
    .yacht-detail { font-size: 13px; color: #d4a574; font-weight: 500; margin-top: 24px; letter-spacing: 1px; }
    @media print {
      body { background: white; }
      .card { box-shadow: none; border: 2px solid #e5e7eb; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-text">GRANITE PARK CAPITAL</div>
    <div class="subtitle">Private Investor Event</div>
    <div class="event-name">${event.name}</div>
    <div class="event-details">
      ${eventDateFormatted}<br>
      ${event.location}
    </div>
    <div class="qr-container">
      <img src="${qrDataUrl}" alt="Check-in QR Code">
    </div>
    <div class="instructions">Scan to Check In</div>
    <div class="instructions-sub">Open your camera app and point it at the QR code</div>
    <div class="yacht-detail">YACHT ${event.yacht_name} — PRIVATE EVENT</div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
