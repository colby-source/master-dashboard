# GoHighLevel Sequence Audit — Grand Park Capital
**Generated: 2026-03-13**

---

## PIPELINE 1: Event Funnel Pipeline
**ID:** `GMqxElyHPSr2karweCGS`

### Stages (in order)
| # | Stage | ID |
|---|-------|----|
| 0 | Waitlist | `751ca568-5aca-4aec-a201-8084d29bc3ef` |
| 1 | Registered | `b76428d2-1a06-4b21-b864-cce89cad682d` |
| 2 | Approved For Event | `c50a0f7d-89c7-4998-9de9-36e5c8885992` |
| 3 | Didn't attend mixer | `bca99fa3-6655-410e-b589-9f603a9b2b7e` |
| 4 | Attended Mixer | `7bff2aff-62ef-46aa-b1bb-1ed7c9c8d08c` |
| 5 | 1 on 1 scheduled | `450dd1b9-6ab2-4c86-af74-ed9f8e5ec373` |
| 6 | Due Diligence | `baac325b-4fc1-44f2-8ce4-1b59b401643d` |
| 7 | Commitment Letter Provided | `6872cb56-dbf7-419b-80f8-5a956672baec` |
| 8 | Needs More Time / Nurture | `39f7b226-bdf6-4bcb-8fea-66c9d6fde441` |
| 9 | Won | `9cfc91a4-9b2d-4f3c-b743-1e5828119a0f` |
| 10 | Not Interested | `f287eacd-8301-434d-8b84-789529def681` |

---

### Workflows Mapped to Event Funnel Stages

#### STAGE 0: Waitlist
**Workflow:** "Added To Waitlist" — `30691577-27a6-4013-8459-c7de0bd66b29` — **PUBLISHED** (v11)
- Triggers when contact enters Waitlist stage
- Last updated: 2026-01-02

**Workflow:** "Granite Park Investor Event - (Waitlist Confirmation)" — `e7aa08dc-6752-4e97-87ac-5ccd44b0a2c2` — **PUBLISHED** (v7)
- Sends waitlist confirmation messaging
- Last updated: 2025-12-06

**Workflow:** "Granite Park Investor Event - Popup Workflow" — `3e338e90-9970-43e3-bc79-dccd9e4d3400` — **PUBLISHED** (v12)
- Popup/form submission trigger for event sign-up
- Last updated: 2025-11-25

---

#### STAGE 1: Registered
**Workflow:** "Added To Registered" — `6cb480ae-8d4d-4418-9346-17a28b340d31` — **DRAFT** (v15)
- Triggers when contact moves to Registered
- Last updated: 2026-03-12 (recently modified)
- **NOTE: DRAFT — NOT ACTIVE**

**Workflow:** "Granite Park Investor Event – (Create Opportunity + Internal Notification)" — `c8fd75ed-203b-40b3-bc86-155f745c63f1` — **PUBLISHED** (v33)
- Creates opportunity in pipeline + sends internal team notification
- Last updated: 2025-12-08

---

#### STAGE 2: Approved For Event
**Workflow:** "Added To Approved For Event" — `bff83a70-79ab-492e-ae36-c64bd7b05f67` — **PUBLISHED** (v14)
- Triggers when contact is approved
- Last updated: 2026-01-02

**Workflow:** "Granite Park Investor Event – (Approved and Book Appointment)" — `9dc33e3f-7bc8-47dd-a7b8-7b2885f84403` — **PUBLISHED** (v45)
- Sends approval email + booking link for the event
- Last updated: 2026-03-06 (heavily iterated — 45 versions)

**Workflow:** "Granite Park Investor Event - Proof of Funds (Custom Field)" — `79521156-9a6e-4f34-a2f1-085189d37c95` — **PUBLISHED** (v20)
- Handles proof of funds submission via custom fields
- Last updated: 2025-12-08

**Workflow:** "Granite Park Investor Event - Proof of Funds (Missing/Didn't Submit)" — `fe659b14-469c-4534-809b-f0a5577da72b` — **PUBLISHED** (v16)
- Follow-up sequence for contacts who haven't submitted proof of funds
- Last updated: 2025-12-08

**Workflow:** "Granite Park Investor Event – Confirmation + Reminders (Emails)" — `5db9d0ec-d0fe-46e6-8e11-b378dde3385e` — **PUBLISHED** (v36)
- Event confirmation + pre-event email reminder sequence
- Last updated: 2026-03-12 (recently modified)

**Workflow:** "Granite Park Investor Event – Confirmation + Reminders (SMS)" — `a91a3dd7-7cce-4597-a04c-b9736b55c1ec` — **PUBLISHED** (v6)
- Event confirmation + pre-event SMS reminder sequence
- Last updated: 2026-03-12

---

#### STAGE 3: Didn't Attend Mixer
**Workflow:** "Added To Didn't Attend" — `eb9cb1f3-e897-4d6e-8dd2-a0ab1ff6c3fb` — **PUBLISHED** (v9)
- Triggers when marked as didn't attend
- Last updated: 2026-01-02

**Workflow:** "Granite Park Mixers - Registered, Didn't Attend" — `6b16ef02-f513-4b2d-9c6a-46fe5e6a7e9b` — **PUBLISHED** (v24)
- Re-engagement sequence for no-shows
- Last updated: 2025-11-13

---

#### STAGE 4: Attended Mixer
**Workflow:** "Added Tag - Attended" — `93e30c04-7e51-493f-b29c-40cf66c9aa5e` — **PUBLISHED** (v12)
- Triggers when "Attended" tag is added
- Last updated: 2026-01-02

**Workflow:** "Granite Park Investor Event - Attended Event Post Follow Up" — `d0569095-7c57-4536-95ed-a6ddc68cb7e3` — **PUBLISHED** (v18)
- Post-event follow-up email sequence for attendees
- Last updated: 2026-03-02

**Workflow:** "Create Opportunity (attended)" — `b862c6b5-b813-4569-a18d-3d95f48f29e7` — **PUBLISHED** (v2)
- Creates a pipeline opportunity for attendees
- Last updated: 2025-09-24

---

#### STAGE 5: 1 on 1 Scheduled
No dedicated GHL workflow — handled by the codebase meeting scheduler (`server/services/meeting-scheduler.ts`).

**Automated touchpoints from code:**
1. **Meeting Confirmation Email** (sent immediately via GHL)
   - Subject: `Confirmed: {day}, {date} at {time} ET — Granite Park Capital`
   - Body:
   > Hi there,
   > This confirms your meeting with Marc Realty at **{slot time}** (30 minutes).
   > **What to expect:** A brief overview of Granite Park Capital Affordable Housing Fund II and how it may fit your portfolio. No prep needed on your end.
   > If you need to reschedule, just reply to this email and we'll find another time.
   > Looking forward to connecting,
   > Marc Realty
   > Granite Park Capital

2. **24-Hour Reminder SMS**
   > Quick reminder — you have a call with Marc from Granite Park Capital tomorrow at {slot time}. Looking forward to it!

3. **1-Hour Reminder SMS**
   > Just a heads up — your call with Marc from Granite Park Capital starts in about an hour ({slot time}). Talk soon!

---

#### STAGE 6: Due Diligence
No dedicated GHL workflow — post-meeting follow-up is handled by the codebase (`server/services/enrichment/meeting-processor.ts`).

**Automated post-meeting emails based on Claude AI analysis of meeting transcript:**

**HIGH LIKELIHOOD (≥60%) — Data Room Follow-Up:**
> Hi {name},
> Great speaking with you today. I really enjoyed our conversation and wanted to follow up while everything is fresh.
> {Claude-generated personalized follow-up based on meeting transcript}
> As discussed, I'd like to share our investor materials with you. You can access the data room here: {data room URL}
> Inside you'll find our PPM, subscription documents, and detailed fund performance materials.
> {Specific next steps from meeting analysis}
> Would you be available for a brief follow-up call this week to address any questions after you've had a chance to review?
> Best,
> Marc Menowitz
> Granite Park Capital

**MEDIUM LIKELIHOOD (30-59%) — Nurture Follow-Up:**
> Hi {name},
> Thank you for taking the time to connect today. I enjoyed learning more about your investment approach.
> {Claude-generated personalized follow-up}
> I wanted to share a few additional resources about our approach to affordable housing:
> - Our portfolio currently includes 5,500 units with Section 8 contracts, providing stable, government-backed income
> - Fund I was fully subscribed at $50M — Fund II builds on that track record
> - We target 7% preferred return with 12-16% net IRR and quarterly distributions
> {Specific next steps}
> I'd be happy to share more detailed materials or schedule another call whenever you're ready to dive deeper.
> Best,
> Marc Menowitz
> Granite Park Capital

**LOW LIKELIHOOD (<30%) — Polite Close:**
> Hi {name},
> Thank you for taking the time to chat today. I appreciated learning about your investment priorities.
> {Claude-generated personalized follow-up}
> While the timing may not be right for Fund II, I'd love to keep you in the loop on our progress. We send quarterly updates on portfolio performance and new developments in the affordable housing space.
> If your situation changes or you'd like to explore this further down the line, my door is always open.
> Wishing you all the best,
> Marc Menowitz
> Granite Park Capital

---

#### STAGE 8: Needs More Time / Nurture
**Workflow:** "Added To Needs More Time/Nurture" — `c7c152d1-4db3-4392-8acb-168a031f165a` — **PUBLISHED** (v7)
- Long-term nurture sequence
- Last updated: 2026-03-02

**Workflow:** "Granite Park Capital - 6-Month Attended / Nurture" — `66799353-7373-49af-8c27-c127ffe1b473` — **DRAFT** (v3)
- 6-month drip for past attendees in nurture
- **NOTE: DRAFT — NOT ACTIVE**

---

#### STAGE 10: Not Interested
**Workflow:** "Added To Not Interested" — `8b32a422-0985-4da8-894c-610576d775ab` — **PUBLISHED** (v4)
- Opt-out / removal workflow
- Last updated: 2026-01-02

---

## PIPELINE 2: Meta Lead Intake
**ID:** `iJ5eS6fANsGVejDo6ubW`
**Created:** 2026-03-04

### Stages (in order)
| # | Stage | ID |
|---|-------|----|
| 0 | A+ — Confirm Immediately | `7a6d6988-2a04-4885-b089-f08805149254` |
| 1 | A — Confirm Invite | `fc55d44e-30aa-4e06-8b3d-86d49a0e5e10` |
| 2 | B — Needs Manual Review | `0846cea4-3ba7-4ee9-bd1f-e82bcd114925` |
| 3 | Invited — Awaiting RSVP | `3e8d6b7e-4752-4139-98cb-ab35eb4739be` |
| 4 | Confirmed RSVP | `39d0002c-cb46-4b38-9b5c-f817915f6c93` |
| 5 | Declined / Not Now | `a457423c-15bb-4b50-9af1-be27d480e2ba` |
| 6 | Attended Mixer | `a5e34731-6457-450f-b105-f4815ac3e00d` |
| 7 | 1 on 1 Scheduled | `96148e08-2249-4de8-aea2-4ca712bca8c7` |
| 8 | Due Diligence | `2c89f40d-ad6f-4f42-9b97-65d3afe04823` |
| 9 | Committed | `78bf5f0c-26ea-4f89-8573-21dfeb0da307` |

### Workflows Mapped to Meta Lead Intake Stages

#### STAGES 0-2: Auto Qualification (A+, A, B)
**Workflow:** "Meta Lead Intake — Auto Qualification" — `d59db5e8-829f-4448-9abe-088972f7e932` — **PUBLISHED** (v21)
- Automatically scores and routes Meta ad leads into A+/A/B tiers
- Last updated: 2026-03-05

#### STAGE 3: Invited — Awaiting RSVP
**Workflow:** "Invited — Send Yacht Approval Email" — `d328d559-3677-4412-8e00-863a6120c8c0` — **PUBLISHED** (v5)
- Sends yacht/event approval + invitation email
- Last updated: 2026-03-06

#### STAGES 4-9: Confirmed RSVP → Committed
These stages share workflows with the Event Funnel Pipeline (confirmation/reminders, attended follow-up, 1-on-1 scheduling, etc.)

---

## CROSS-PIPELINE WORKFLOWS (Supporting Both Pipelines)

| Workflow | Status | Purpose |
|----------|--------|---------|
| Create Opportunity | PUBLISHED (v4) | Creates pipeline opportunity on form submit |
| Granite Park Mixers - CPA | PUBLISHED (v12) | CPA-specific mixer invite flow |
| Recipe - Appointment Confirmation + Reminder | PUBLISHED (v5) | Generic appointment confirmation |
| Trigger Link - Next Mixer YES Action | PUBLISHED (v4) | "Yes" trigger link for next mixer invite |
| Trigger Link - Remove Future Invites NO Action | PUBLISHED (v4) | "No" trigger link to opt out of future invites |
| LinkedIn URL - Contact copied to Opportunity | PUBLISHED (v5) | Syncs LinkedIn URL to opportunity |

---

## DRAFT / INACTIVE WORKFLOWS (Not Running)

| Workflow | Versions | Notes |
|----------|----------|-------|
| Added To Registered | v15 (DRAFT) | Stage trigger exists but NOT active |
| Copy - Added To Waitlist | v3 (DRAFT) | Duplicate/test |
| Copy - Granite Park Investor Event - (Waitlist Confirmation) | v5 (DRAFT) | Duplicate/test |
| Copy - Granite Park Investor Event – Confirmation + Reminders (Emails) | v5 (DRAFT) | Duplicate/test |
| Cold Email Follow Up - Non-Granite Park Mixers | v11 (DRAFT) | Non-GP mixer follow-up |
| Granite Park Capital - 6-Month Attended / Nurture | v3 (DRAFT) | Long-term nurture drip |
| Post-Event Follow-Up v2 — Attended Mixer | v3 (DRAFT) | V2 of post-event follow-up |
| Webinar - Form Submitted | v3 (DRAFT) | Webinar signup |
| Who Referred You - Contact copied to Opportunity | v4 (DRAFT) | Referral tracking |
| 3x unnamed "New Workflow" | v1 (DRAFT) | Empty/unused |

---

## COMPLETE TOUCHPOINT MAP: Contact Journey

### Path A: Event Funnel Pipeline (Cold Outreach / Organic)
```
Form Submit / Popup
  └─→ [Popup Workflow] → Creates contact + opportunity
       └─→ WAITLIST
            ├─→ [Added To Waitlist] — stage trigger actions
            └─→ [Waitlist Confirmation] — confirmation email
                 └─→ REGISTERED
                      └─→ [Create Opportunity + Internal Notification] — team alert
                           └─→ APPROVED FOR EVENT
                                ├─→ [Added To Approved For Event] — stage trigger
                                ├─→ [Approved and Book Appointment] — approval email + booking (v45)
                                ├─→ [Proof of Funds (Custom Field)] — POF collection
                                ├─→ [Proof of Funds (Missing)] — POF follow-up chase
                                ├─→ [Confirmation + Reminders (Emails)] — event reminders
                                └─→ [Confirmation + Reminders (SMS)] — SMS reminders
                                     │
                                     ├─→ ATTENDED MIXER
                                     │    ├─→ [Added Tag - Attended]
                                     │    ├─→ [Create Opportunity (attended)]
                                     │    └─→ [Attended Event Post Follow Up] — post-event emails
                                     │         └─→ 1 ON 1 SCHEDULED
                                     │              ├─→ Meeting confirmation email (code)
                                     │              ├─→ 24h SMS reminder (code)
                                     │              └─→ 1h SMS reminder (code)
                                     │                   └─→ DUE DILIGENCE
                                     │                        └─→ Post-meeting follow-up (code, AI-generated)
                                     │                             ├─→ ≥60%: Data room + follow-up call
                                     │                             ├─→ 30-59%: Nurture materials
                                     │                             └─→ <30%: Polite close
                                     │                                  │
                                     │                                  ├─→ COMMITMENT LETTER → WON
                                     │                                  ├─→ NEEDS MORE TIME / NURTURE
                                     │                                  │    └─→ [Added To Needs More Time/Nurture]
                                     │                                  └─→ NOT INTERESTED
                                     │                                       └─→ [Added To Not Interested]
                                     │
                                     └─→ DIDN'T ATTEND MIXER
                                          ├─→ [Added To Didn't Attend]
                                          └─→ [Registered, Didn't Attend] — re-engagement
```

### Path B: Meta Lead Intake (Paid Ads)
```
Meta Ad Lead Form Submit
  └─→ [Meta Lead Intake — Auto Qualification]
       ├─→ A+ — Confirm Immediately (auto-approve)
       ├─→ A — Confirm Invite (auto-approve)
       └─→ B — Needs Manual Review (manual decision)
            └─→ INVITED — AWAITING RSVP
                 └─→ [Invited — Send Yacht Approval Email]
                      ├─→ CONFIRMED RSVP → shares Event Funnel workflows from "Approved" onward
                      └─→ DECLINED / NOT NOW
```

---

## GAPS & OBSERVATIONS

1. **"Added To Registered" is DRAFT** — contacts entering the Registered stage don't trigger the stage workflow. Only the "Create Opportunity + Internal Notification" workflow runs.

2. **No workflow for Stages 7-9 (Commitment Letter, Won)** — these terminal stages have no automated follow-up. Consider: commitment letter delivery, welcome/onboarding email, post-close thank you.

3. **"6-Month Attended / Nurture" is DRAFT** — the long-term nurture drip for past attendees is not running. Only the stage-trigger "Added To Needs More Time/Nurture" is active.

4. **3 "Copy" workflows are DRAFT** — appear to be test duplicates that were never cleaned up.

5. **Post-Event Follow-Up v2 is DRAFT** — a v2 of the attended mixer follow-up was started but never published. The v1 (`d0569095`) is still the active one.

6. **Meta Lead Intake has no dedicated post-RSVP workflows** — it relies on the Event Funnel Pipeline workflows from "Approved" onward. If the email copy references different event names or contexts, these may not match for Meta leads.

7. **Email copy is NOT accessible via GHL API** — the actual email body/subject lines within GHL workflows can only be viewed in the GHL Workflow Builder UI. The code-based emails (meeting confirmation, post-meeting follow-ups) are documented above.

8. **SMS vs Email coverage** — the Confirmation + Reminders workflow has both email (v36) and SMS (v6) versions, but most other sequences appear email-only.

---

## HOW TO GET THE FULL EMAIL COPY

The GHL API does not expose workflow step details (email subjects, body copy, wait times, conditions). To complete this audit with full copy:

1. **Log into GHL** → Automation → Workflows
2. Open each PUBLISHED workflow listed above
3. Click each email/SMS action step to see:
   - Subject line
   - Email body / SMS text
   - Wait/delay between steps
   - Conditional branches (if/else)
4. Screenshot or copy/paste into this document

The workflows with the most email steps to audit:
- Granite Park Investor Event – (Approved and Book Appointment) — **45 versions**, likely has multiple email steps
- Granite Park Investor Event – Confirmation + Reminders (Emails) — **36 versions**
- Granite Park Mixers - Registered, Didn't Attend — **24 versions**
- Granite Park Investor Event - Proof of Funds (Custom Field) — **20 versions**
- Granite Park Investor Event - Attended Event Post Follow Up — **18 versions**
