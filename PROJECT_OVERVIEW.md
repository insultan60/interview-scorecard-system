# Interview Scorecard System — Complete Project Overview

> A full-stack, AI-assisted, stage-gated hiring platform built for **Red Star Technologies**.
> This document explains what the app does, how it is built, how the code is organised, and how to run, configure and extend it. It is written so that someone who has never seen the project can understand all of it.

---

## Table of Contents

1. [What the app is](#1-what-the-app-is)
2. [Core concepts and glossary](#2-core-concepts-and-glossary)
3. [Tech stack](#3-tech-stack)
4. [Repository layout](#4-repository-layout)
5. [End-to-end workflows](#5-end-to-end-workflows)
6. [The scoring engine](#6-the-scoring-engine)
7. [Data model (MongoDB)](#7-data-model-mongodb)
8. [Backend in detail](#8-backend-in-detail)
9. [REST API reference](#9-rest-api-reference)
10. [Frontend in detail](#10-frontend-in-detail)
11. [External integrations](#11-external-integrations)
12. [AI usage and cost control](#12-ai-usage-and-cost-control)
13. [Authentication, roles and security](#13-authentication-roles-and-security)
14. [Data retention and audit trail](#14-data-retention-and-audit-trail)
15. [Configuration: environment variables and runtime settings](#15-configuration)
16. [Local setup and running](#16-local-setup-and-running)
17. [Deployment](#17-deployment)

---

## 1. What the app is

### The problem
HR teams that track interviews in Excel run into two problems:

1. **Data integrity** – misaligned columns can mix up candidates' scores.
2. **Process enforcement** – nothing stops someone skipping a stage, or hiring a candidate who failed a critical evaluation.

### The solution
Interview Scorecard System replaces the spreadsheet with a structured pipeline where:

- **AI proposes, humans decide.** Claude (Anthropic) reads a transcript, résumé or questionnaire and proposes 1–5 scores with a short justification. A proposed score counts for nothing until a human approves or overrides it (public résumé/HR-questionnaire screens are the one exception — see §5.2).
- **Gates block advancement.** A candidate cannot move to the next stage until the current stage average meets its pass threshold.
- **The final verdict is computed, not guessed.** A pure-math engine produces a weighted total and a disposition of `HIRE`, `MAYBE` or `NO_HIRE`.
- **Everything is audited.** Overrides, approvals, weight changes, final decisions, offers and data purges are written to an immutable audit log.

### Who uses it
Internal HR/recruiting staff (roles: `admin`, `hiring_manager`, `recruiter`, `interviewer`) use the authenticated app. **Candidates** interact only with two public pages: a job application form and an interview-availability form.

---

## 2. Core concepts and glossary

| Term (code) | Term (UI) | Meaning |
|---|---|---|
| **Requisition** | Job Openings | A job opening. Holds the job description, employment/workplace details, a *snapshot* of pipeline stages, thresholds, screening criteria and questionnaire. |
| **Pipeline Template** | Hiring Stages | A reusable set of stages (order, weight, pass threshold). A requisition copies ("snapshots") a template when created, so later template edits never change an open job. |
| **Stage** | Stage | One step in the hiring process (e.g. Résumé Screen, HR Interview, Technical). Has `stageType`, `inputType`, `weight`, `passThreshold`, `enabled`, `order`. |
| **Scorecard** | Scorecard | The per-requisition rubric: for each stage, a list of *attributes* (name, question, "what a 5 looks like", red flags). AI-generated, then editable. |
| **Candidate** | Candidates | A person (name, email, phone, résumé). A candidate can apply to several requisitions. |
| **Application** | – | The link between one candidate and one requisition. Stores stage progress, weighted total, disposition, rank, final decision, offer-letter state. |
| **Interview** | Interview Room | One stage instance for one application: meeting link, consent, transcript/artifact, AI + approved scores, stage average. |
| **Attribute** | Question / criterion | One scored item in a scorecard stage. |
| **Gate** | – | `stageAverage >= passThreshold`. |
| **Disposition** | – | System-computed verdict: `HIRE` / `MAYBE` / `NO_HIRE`. |
| **Final decision** | – | The human action recorded afterwards: `hired` / `rejected` / `withdrawn`. |

### Stage types and input types
- **Stage types:** `resume_screen`, `hr_screen`, `hr_interview`, `task_performance`, `technical`, `simulation`, `final`, `client`, `culture`, `reference`, `background`, `offer`.
- **Input types** (how a stage collects evidence): `transcript` (meeting transcript), `artifact` (uploaded file such as a résumé or task), `pass_fail` (human yes/no), `status_only` (no score, no gate – just "reached"), `manual_rubric` (human enters scores directly, e.g. a simulation).

### Default pipeline ("Standard Hiring Stages")
| # | Stage | Type | Input | Weight | Pass ≥ |
|---|---|---|---|---|---|
| 1 | Résumé Screen | resume_screen | artifact | 10% | 3.0 |
| 2 | Initial Screening | hr_screen | artifact | 10% | 3.0 |
| 3 | HR Interview | hr_interview | transcript | 15% | 3.0 |
| 4 | Sales Simulation | simulation | manual_rubric | 25% | 3.0 |
| 5 | Technical / Ops Manager | technical | transcript | 25% | 3.0 |
| 6 | Final / CEO | final | transcript | 15% | 3.0 |

Optional, disabled by default (weight 0): Task Performance, Client Interview, Culture Fit, Reference Check (`pass_fail`), Background Check (`pass_fail`). Enabled scored stage weights must total 100%. (An `offer` stage exists in the enum but is commented out of the defaults — offer letters are now an application-level feature, not a stage.)

---

## 3. Tech stack

**Backend** (`server/`, CommonJS)
- Node.js 18+, Express 4, Mongoose (MongoDB 6+)
- `jsonwebtoken` + `bcryptjs` (auth), `helmet`, `cors`, `morgan`
- `multer` (uploads, in-memory), Cloudinary (file storage), `googleapis` (Meet + Calendar), `nodemailer` (Gmail SMTP), `axios`
- Text extraction from uploaded PDFs/docs via `utils/textExtractor.js`
- Custom file/console logger with daily log files in `server/logs/`

**Frontend** (`client/`, ESM)
- React 18 + Vite 5, React Router v6
- Tailwind CSS 3 + shadcn/ui-style components (Radix UI primitives) in `components/ui/`
- `@tanstack/react-table`, Recharts, `react-quill-new` (rich-text editor), `react-day-picker`, `dayjs`, `lucide-react`, `react-hot-toast`, Axios
- `@emailjs/browser` as a browser-side email fallback

**AI / services:** Anthropic Claude Messages API, Google Meet REST + Calendar API, Slack incoming webhook, Gmail SMTP, Cloudflare Turnstile (CAPTCHA), Cloudinary.

**Hosting hints in repo:** `client/vercel.json` (SPA rewrite for Vercel), `nginx.conf.example` (reverse-proxy template), CORS comments mention Render for the API.

---

## 4. Repository layout

```
interview-scorecard-system/
├── package.json              # Root scripts: dev, server, client, seed (uses concurrently, nodemon)
├── .env.example              # Server env template (the real .env lives in the repo root)
├── nginx.conf.example        # Reverse-proxy template for self-hosting
├── README.md                 # Shorter, older readme
├── PROJECT_OVERVIEW.md       # This document
│
├── server/
│   ├── index.js              # Express bootstrap: helmet, CORS allow-list, routes, error handlers, retention schedule
│   ├── config/
│   │   ├── db.js             # Mongo connection (one retry)
│   │   └── cloudinary.js     # uploadBuffer / destroyFile helpers
│   ├── middleware/
│   │   ├── auth.js           # requireAuth (JWT) + requireRole(...roles)
│   │   ├── errorHandler.js   # notFoundHandler + errorHandler (maps custom errors to HTTP codes)
│   │   └── upload.js         # multer memory storage
│   ├── models/               # User, PipelineTemplate, Requisition, Scorecard, Candidate,
│   │                         # Application, Interview, AuditLog, Setting
│   ├── controllers/          # auth, requisition, pipeline, candidate, interview, scoring,
│   │                         # settings, audit, user
│   ├── routes/               # One router per controller, mounted under /api/*
│   ├── services/
│   │   ├── claudeClient.js         # Single gateway to Anthropic: retry, cost, spend cap
│   │   ├── questionGenerator.js    # Generates scorecard questions/rubrics from the JD
│   │   ├── aiScorer.js             # Scores a transcript/artifact against a rubric
│   │   ├── scoringEngine.js        # Pure math: stage average, gates, weighted total, disposition, rank
│   │   ├── transcriptProvider.js   # Provider dispatcher (google_meet live; zoom/fathom stubs)
│   │   ├── googleMeet.js           # Create/cancel Meet + Calendar event, fetch transcript
│   │   ├── emailNotifier.js        # Gmail emails (meeting link, offer, confirmation, reset, ...)
│   │   ├── slackNotifier.js        # Slack alerts
│   │   ├── captchaService.js       # Cloudflare Turnstile verification
│   │   ├── retentionService.js     # Daily purge of transcripts/artifacts for closed requisitions
│   │   └── fileReferenceCleanup.js # Delete a Cloudinary file only if nothing else references it
│   ├── utils/                # constants, errors, helpers, logger, retry, secrets,
│   │                         # textExtractor, requisitionStatus, meetingLifecycle
│   ├── seeds/seedDefaults.js # Admin user, default pipeline, default settings
│   ├── logs/                 # Daily log files (git-ignored content)
│   └── uploads/              # Placeholder (files actually go to Cloudinary)
│
├── client/
│   ├── index.html, vite.config.js, tailwind.config.js, components.json, vercel.json
│   └── src/
│       ├── main.jsx, App.jsx          # Entry + route table
│       ├── context/AuthContext.jsx    # Session (user + JWT)
│       ├── hooks/useApi.js            # Shared Axios instance + interceptors
│       ├── services/emailService.js   # Browser EmailJS fallback
│       ├── constants/screeningCriteria.json  # Education / Experience option lists
│       ├── utils/formatters.js, lib/utils.js
│       ├── components/                # App components (+ ui/ shadcn primitives)
│       └── pages/                     # One file per screen (see §10)
│
└── shared/                   # (currently empty)
```

---

## 5. End-to-end workflows

### 5.1 Recruiter workflow (manual path)

```
1. Create a Requisition (job opening)
   - Title, employment type (+ type-specific details), workplace (onsite/hybrid/remote),
     job description (rich text), pipeline template, hire/maybe thresholds,
     screening criteria, application questionnaire, optional deadline.
   - Stages are SNAPSHOTTED from the chosen template.
2. Generate the Scorecard with AI (from the JD) → review/edit/add/delete questions,
   or clone a scorecard from another requisition.
3. Add candidates (single, bulk import up to 500 rows, or attach existing candidates).
4. For each stage, in order:
   a. (Optional) Email the candidate to request their availability.
   b. Create a Google Meet (with Calendar event) or paste a link; email it to the candidate.
   c. Record candidate CONSENT for recording/AI analysis (required before scoring transcript stages).
   d. Interview happens.
   e. Transcript is fetched from Google Meet, or a .txt/.doc file is uploaded manually.
      (Artifact stages: upload the file instead.)
   f. "Score" → Claude proposes 1–5 per attribute with justifications.
   g. Human reviews: approve, or override individual scores with a reason (audited).
      Manual-rubric stages: reviewer enters the scores directly.
      Pass/fail stages: reviewer clicks pass or fail.
   h. Gate check → advance (next Interview auto-created) or block.
5. When all enabled stages are complete the engine computes weighted total + disposition,
   and candidates are ranked.
6. HR records the final decision (hired / rejected / withdrawn). Slack is notified.
7. For hired candidates: upload & send an offer letter, and send an onboarding form.
8. Close the requisition → after the retention window, raw transcripts/files are purged.
```

Server-side guard rails: a stage can only start when **all earlier enabled stages are approved** (`assertPriorStagesApproved`); closed requisitions are read-only; new candidates/work require an **open** requisition; transcript-stage scoring requires recorded consent; an interview with a still-active calendar meeting must have the meeting cancelled before approval actions.

### 5.2 Public application path (candidate self-service)

Route: `/apply/:id` (public). The candidate fills name, email, 11-digit phone, answers every questionnaire question, uploads a **PDF résumé (≤ 5 MB)** and passes the Turnstile CAPTCHA. `POST /api/requisitions/:id/apply` then:

1. Validates: requisition is open, deadline not passed, CAPTCHA valid, required fields, PDF type/size.
2. Rejects duplicates (same email already applied to this job → `409`).
3. Uploads the résumé to Cloudinary (one copy for the candidate profile, one immutable copy for the application), extracts text.
4. Creates/updates the **Candidate**, auto-generates a **Scorecard** if none exists, creates the **Application** (`source: public_link`).
5. Creates the first-stage **Interview** (Résumé Screen) and, separately, an **HR/Initial Screening** interview whose "transcript" is the Q&A of the questionnaire.
6. **Auto-scores** the résumé with Claude (CV + job description + screening criteria) and **auto-approves** it; auto-scores the questionnaire (using each question's ideal answer when required, else the JD) and auto-approves it. If the résumé passes, the next interview is created.
7. Recomputes the weighted total/disposition, re-ranks all applicants, and sends a confirmation email (best-effort — failure never undoes the application).

Special screening rules baked into prompts: a per-criterion flag lets candidates with an ongoing degree from a virtual/distance university satisfy the education criterion, and a minimum-experience of 0 treats fresh graduates/interns as qualifying. HR can still **override** the initial screening result (reason ≥ 10 chars, audited).

### 5.3 Candidate availability path
`/interview/:id/availability` (public). HR triggers "request availability", which emails the candidate a link. The candidate submits preferred date, start/end time and notes (`candidateAvailability` on the Interview). No login required.

### 5.4 Password reset
`/forgot-password` → emails a one-time link → `/reset-password`. Only a SHA-256 hash of the token is stored, the token expires (default 30 min, configurable 5–120), and resetting invalidates all previously issued JWTs.

---

## 6. The scoring engine

Implemented in [server/services/scoringEngine.js](server/services/scoringEngine.js) as **pure functions** (no DB, no network). The controller fetches data, calls the engine, and persists the result (`recomputeAndPersist` in `scoringController.js`).

1. **Stage average** = mean of the interview's `approvedScore` values (AI scores are never used). No approved scores → `null` (incomplete — never `0`).
2. **Gate**: `passed = stageAverage >= passThreshold` (`null` while incomplete). `pass_fail` stages use the reviewer's recorded result; `status_only` stages are skipped entirely.
3. **Failure short-circuit**: if any gate has failed → `allGatesPassed=false`, `disposition=NO_HIRE`, `weightedTotal=null`.
4. **Incomplete**: if any relevant stage is still incomplete (and none failed) → everything stays `null` (no premature verdict).
5. **Weighted total** = Σ(stageAverage × stageWeight) over scored (non-`pass_fail`) stages, rounded to 4 d.p.
6. **Disposition** (only when all gates passed):
   - `HIRE` if weightedTotal ≥ `hireThreshold` (default 3.5)
   - `MAYBE` if weightedTotal ≥ `maybeThreshold` (default 3.0)
   - otherwise `NO_HIRE`
   - A high weighted total can **never** produce HIRE if any gate failed.
7. **Ranking** (`rankApplications`): by weighted total descending, **competition ranking** for ties (1, 2, 2, 4). Incomplete applications get rank `null` and sort last. Ranks are persisted on `Application.rank` for the whole requisition after every recompute.

Thresholds are stored per requisition (defaults from Settings: hire 3.5, maybe 3.0). A change in disposition writes a `disposition_change` audit entry.

---

## 7. Data model (MongoDB)

All models use Mongoose with timestamps unless noted.

| Collection | Key fields |
|---|---|
| **User** | `name`, `email` (unique), `passwordHash`, `role` (`admin` \| `hiring_manager` \| `recruiter` \| `interviewer`, default `recruiter`), `active`, `passwordChangedAt`, hidden `passwordResetTokenHash` / `passwordResetExpiresAt` |
| **PipelineTemplate** | `name` (unique), `description`, `isDefault`, `autoWeights`, `stages[]` (`key`, `label`, `stageType`, `inputType`, `enabled`, `order`, `weight`, `passThreshold` 1–5) |
| **Requisition** | `title` (≥5 chars), `employmentType` (+ `fullTimeDetails`/`partTimeDetails`/`contractDetails`/`internshipDetails`/`temporaryDetails`), `workplaceType`, `officeLocation`, `remoteRegion`, derived `location`, `jobDescription`, `status` (`open`/`paused`/`closed`/`draft`/legacy `on_hold`), `pipelineTemplateId/Name`, **`stages[]` (snapshot)**, `scorecardId`, `hireThreshold`, `maybeThreshold`, `initialScreeningCriteria[]`, `questionnaire[]` (question, idealAnswer, requireIdealAnswer), `applicationDeadline`, `aiScreeningEnabled`, `closedAt`, `createdBy` |
| **Scorecard** | `requisitionId`, `generatedByAI`, `stages[]` → `{ stageKey, attributes[] }`, attribute = `{ attributeId, name, question, anchor5, redFlags }` |
| **Candidate** | `name`, `email`, `phone` (exactly 11 digits), `resumeFileUrl`, `resumeFilePublicId`, `notes` |
| **Application** | `candidateId`, `requisitionId`, `currentStageKey`, `source` (`public_link`/`manual`), `questionnaireAnswers`, `opportunityDuration`, `stageProgress[]` (`stageKey`, `status`, `stageAverage`, `passed`), `initialScreening{aiScore, aiJustification, passed, overridden, overriddenBy, overrideReason}`, `weightedTotal`, `allGatesPassed`, `disposition`, `rank`, `finalDecision`, `finalDecisionBy`, `rejectionReason`, offer-letter fields (`offerLetterUrl`, `…PublicId`, `…UploadedAt`, `…DeliveryStatus`, `…SentAt`), onboarding-form fields (`onboardingFormDeliveryStatus`, `…SentAt`) |
| **Interview** | `applicationId`, `requisitionId`, `stageKey`, `meetingMode` (`online`/`in_person`), `provider`, `meetingUri`, `calendarEventId`, `meetingStart/End`, `conferenceId`, `designatedScorerId`, `candidateAvailability{…}`, `consentObtained`, `transcriptText`, `transcriptStatus` (`none`/`pending`/`ready`/`failed`), `artifactFileUrl/PublicId`, `scores[]` (`attributeId`, `aiScore`, `aiJustification`, `approvedScore`, `overridden`, `overriddenBy`, `overrideReason`), `stageAverage`, `status` (`pending`/`scheduled`/`transcript_pending`/`scored`/`approved`), `aiTokensUsed{input,output}`, `aiCostUsd` |
| **AuditLog** | `action` (enum), `userId`, `requisitionId`, `applicationId`, `targetType`, `targetId`, `oldValue`, `newValue`, `reason`, `timestamp` |
| **Setting** | `key` (unique), `value` (any), `description`, `updatedAt` — key/value store for runtime config and secrets |

**Relationships:** Requisition 1—1 Scorecard; Requisition 1—N Application; Candidate 1—N Application; Application 1—N Interview (one per stage); everything references the requisition so it can be purged/reported as a unit.

**Audit actions:** `score_override`, `score_approve`, `question_edit`, `stage_toggle`, `weight_change`, `disposition_change`, `final_decision`, `provider_change`, `key_change`, `transcript_upload`, `consent_capture`, `retention_purge`, `requisition_status_change`, `candidate_update`, `requisition_duplicated`, `offer_letter_sent`, `requisition_deleted`.

---

## 8. Backend in detail

### Request pipeline
`helmet` → CORS (allow-list from `CLIENT_URL`, comma-separated, no wildcard) → `express.json` (10 MB) → `morgan` (piped into the logger) → routes → `notFoundHandler` → `errorHandler`. Health check: `GET /api/health`.

Startup (`server/index.js`): connect to MongoDB (exit on failure) → start the retention schedule → listen on `PORT` (default 5000).

### Controllers (what each owns)
- **authController** – login (JWT), `/me`, forgot/reset password.
- **requisitionController** (largest) – CRUD with validation of employment/workplace details, screening criteria and questionnaire; duplicate; delete (cascades); AI scorecard generation, clone and manual edit; ranking; `generate-field` (AI help for writing a field such as a JD); **public** `getPublic` and `applyPublic` (§5.2).
- **pipelineController** – template CRUD, set default, delete; enforces required stages, normalises/equalises weights to 100%.
- **candidateController** – list/search, create (with résumé upload), bulk import (≤500), bulk attach to a requisition, update, apply to a requisition, remove from a requisition, delete, send onboarding form and record its delivery.
- **interviewController** – create interview, create/cancel Google Meet, email meeting link, request/submit availability, record consent, fetch/upload transcript, upload artifact, **AI score**, send offer, Google OAuth callback.
- **scoringController** – approve, override a score, pass/fail, override initial screening, recompute, record final decision, send offer letter, record offer-letter delivery. Contains `recomputeAndPersist`, `persistRanks`, `getOrCreateNextInterview`.
- **settingsController** – list (secrets stripped), key status (masked), update (admin only), test an API connection, AI-usage report.
- **auditController** – filtered/paginated audit log. **userController** – list users (for scorer assignment).

### Services
- **claudeClient.callClaude** – the *only* place the Anthropic API is called. Resolves model per tier (Setting overrides `.env`), enforces the monthly spend cap, retries (auth errors never retried; 429 waits and retries; network errors back off 3s/9s/27s), 180 s timeout, strips JSON fences, retries once on invalid JSON when `expectJson`, computes cost from a rate table, and accumulates monthly spend in `Setting.aiMonthlySpend`.
- **questionGenerator** – builds the scorecard (5–8 questions per scored stage with `anchor5` and `redFlags`), chunking stages into batches.
- **aiScorer** – builds the stage-specific prompt (résumé stage uses CV + JD + criteria; HR stage uses questionnaire answers or an HR transcript), calls Claude, maps results by `attributeId` (never array position), saves proposed scores, accumulates tokens/cost. Transcripts under 30 words are rejected (HR stages excepted) and marked `failed`.
- **googleMeet** – creates Meet spaces + Calendar events, cancels them, locates the conference record and assembles the transcript with resolved speaker names.
- **transcriptProvider** – picks the active provider (Setting `activeTranscriptProvider` → env). Zoom and Fathom are placeholders that throw "not enabled".
- **emailNotifier** – Gmail via nodemailer: meeting link, availability request, application confirmation, offer, onboarding form, password reset.
- **slackNotifier** – transcript/score ready, final decision, candidate stuck, spend-warning.
- **captchaService** – Turnstile; if the site/secret keys are unset the check is skipped (disabled).
- **retentionService** – see §14. **fileReferenceCleanup** – deletes a Cloudinary file only if no record still references it.

### Utilities
`constants.js` (all enums, default pipeline, default settings, cost table), `errors.js` (`ValidationError` 400, `ApiKeyError` 401, `SpendCapError` 402, `RateLimitError` 429, `TranscriptNotReadyError`, `ServiceError`, …), `helpers.js` (`asyncHandler`, `round`, `normalizeWeights`, `currentMonthRange`, `getEnabledStagesSorted`, `sanitizeUser`), `secrets.js` (credential resolution + masking), `retry.js`, `logger.js`, `textExtractor.js`, `requisitionStatus.js` (open/not-closed guards), `meetingLifecycle.js`.

### Requisition status rules
- `open` – accepts applicants and new stage work.
- `paused` / `draft` – configurable and can finish in-flight work, but won't auto-start the next stage or accept new applicants.
- `closed` – read-only; starts the retention clock (`closedAt`).

---

## 9. REST API reference

Base path `/api`. All routes need `Authorization: Bearer <jwt>` unless marked **public**. Errors return `{ error: "<CODE>", message: "<human text>" }`.

| Area | Method & path | Purpose |
|---|---|---|
| Health | `GET /health` | **public** liveness check |
| Auth | `POST /auth/login` | **public** – email+password → `{ token, user }` |
| | `POST /auth/forgot-password`, `POST /auth/reset-password` | **public** |
| | `GET /auth/me` | current user |
| Requisitions | `GET /requisitions/:id/public` | **public** job info for apply page |
| | `POST /requisitions/:id/apply` | **public** (multipart, CAPTCHA) application |
| | `GET /requisitions`, `POST /requisitions` | list / create |
| | `GET/PATCH/DELETE /requisitions/:id` | read / update / delete |
| | `POST /requisitions/:id/duplicate` | copy a job |
| | `POST /requisitions/generate-field` | AI-assist a form field |
| | `GET/PATCH /requisitions/:id/scorecard` | read / edit rubric |
| | `POST /requisitions/:id/generate-scorecard` | AI-generate rubric |
| | `POST /requisitions/:id/clone-scorecard` | copy rubric from another job |
| | `GET /requisitions/:id/ranking` | ranked applicants |
| Pipelines | `GET/POST /pipelines`, `PATCH/DELETE /pipelines/:id`, `PUT /pipelines/:id/default` | templates |
| Candidates | `GET/POST /candidates` (POST multipart `resume`) | list / create |
| | `POST /candidates/bulk`, `POST /candidates/bulk-attach` | bulk ops |
| | `GET/PATCH/DELETE /candidates/:id` | read / update / delete |
| | `POST /candidates/:id/apply` | attach to a requisition |
| | `DELETE /candidates/:id/requisitions/:requisitionId` | detach |
| | `POST /candidates/send-onboarding-form`, `PATCH /candidates/onboarding-form-delivery` | onboarding form |
| Interviews | `GET /interviews/google/callback` | **public** Google OAuth redirect |
| | `GET/POST /interviews/:id/availability/public` | **public** candidate availability |
| | `GET /interviews`, `GET /interviews/:id`, `POST /interviews` | list / read / create |
| | `POST /interviews/:id/meeting`, `DELETE …/meeting` | create / cancel Meet |
| | `POST …/send-meeting-email`, `…/request-availability` | emails |
| | `POST …/consent` | record consent |
| | `POST …/fetch-transcript`, `…/upload-transcript`, `…/upload-artifact` | evidence |
| | `POST …/score` | run AI scoring |
| | `POST …/send-offer` | offer via interview |
| Scoring | `PATCH /scoring/interview/:id/approve` | approve (optionally with `overrides[]`) |
| | `PATCH /scoring/interview/:id/override` | override one score (reason required) |
| | `PATCH /scoring/interview/:id/pass-fail` | pass/fail stages |
| | `PATCH /scoring/application/:id/override-initial-screening` | HR override |
| | `POST /scoring/application/:id/recompute` | force recompute |
| | `PATCH /scoring/application/:id/decision` | hired / rejected / withdrawn |
| | `POST /scoring/application/:id/send-offer-letter`, `PATCH …/offer-letter-delivery` | offer letter |
| Settings | `GET /settings`, `GET /settings/key-status`, `GET /settings/ai-usage` | read |
| | `PUT /settings/:key`, `POST /settings/test-api` | **admin only** |
| Audit | `GET /audit` | audit log query |
| Users | `GET /users` | list users |

---

## 10. Frontend in detail

### Routing ([client/src/App.jsx](client/src/App.jsx))
| Path | Page | Access |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password` | Auth pages | public |
| `/apply/:id` | `CandidateApply` – application form with questionnaire, résumé upload, CAPTCHA | public |
| `/interview/:id/availability` | `CandidateAvailability` | public |
| `/` | `Dashboard` – open jobs, candidates in flight, AI spend vs. cap, recent activity | auth |
| `/requisitions`, `/requisitions/new` | `Requisitions` – list + create wizard | auth |
| `/requisitions/:id` | `RequisitionDetail` – job info, scorecard editor, stage config, candidates | auth |
| `/requisitions/:id/candidates` | `RequisitionCandidates` – ranked applicants for a job | auth |
| `/pipelines` | `Pipelines` ("Hiring Stages") – template editor with weights/thresholds | auth |
| `/candidates` | `Candidates` – global candidate table, bulk import, attach, onboarding form | auth |
| `/interview/:id` | `InterviewRoom` – the core workspace for one stage (meeting, consent, transcript, AI scoring, approval) | auth |
| `/audit-log` | `AuditLog` – filterable history | auth |
| `/settings` | `Settings` – tabs: Integrations, Scoring, Transcripts, Spend & Usage | auth |

Protected pages are wrapped in `RequireAuth` + `Layout` (collapsible `Sidebar`; collapse state persisted in `localStorage`). Sidebar items: Dashboard, Job Openings, Hiring Stages, Candidates, Audit Log, Settings.

### Key components
`PipelineStepper` (stage progress), `ScorecardEditor`, `ScoreReviewTable` (AI vs. approved scores, override UI), `CandidateRankTable`, `WeightConfig`, `ExportButton`, `SendOnboardingFormModal`, `RichTextViewer`, `StatsCard`, `AlertBanner`, plus `ui/*` shadcn primitives (dialog, select, tabs, table, calendar, time-picker, etc.).

### State and API access
- `AuthContext` – holds `user`, `login`, `logout`; token stored in `localStorage` (`interview_scorecard_token`) and validated against `/auth/me` on load.
- `hooks/useApi.js` – shared Axios instance (`baseURL = VITE_API_URL`); attaches the JWT; on a session `AUTH_ERROR` 401 it clears the token and redirects to `/login`; all other errors surface as toasts. (Third-party 401s, e.g. Google scope errors, deliberately do **not** log the user out.)
- Path alias `@` → `client/src`. Dev server on port 5173 proxies `/api` to `localhost:5000`.
- `services/emailService.js` – optional EmailJS fallback if the server's Gmail send fails (`VITE_EMAILJS_*`).

---

## 11. External integrations

| Service | Used for | Required? |
|---|---|---|
| **MongoDB** | All data | Yes |
| **Anthropic Claude** | Scorecard generation, résumé/questionnaire/transcript scoring, field assist | Yes for AI features |
| **Cloudinary** | Résumés, artifacts, offer letters (hosting filesystems are ephemeral) | Yes for uploads |
| **Google Meet + Calendar** (OAuth 2, refresh token) | Create meetings, fetch transcripts. Scopes: `calendar.events`, `meetings.space.created`, `meetings.space.readonly`. Transcripts require a paid Workspace plan. | Optional – manual link + transcript upload work without it |
| **Gmail SMTP** (App Password) | Candidate/user emails | Needed for emails |
| **Slack webhook** | Notifications | Optional |
| **Cloudflare Turnstile** | CAPTCHA on public apply | Optional (skipped if keys absent) |
| **EmailJS** (browser) | Fallback email | Optional |

Credentials (Anthropic key, Google client id/secret/refresh token, Slack webhook, Gmail user/password) can be set in `.env` **or** overridden at runtime from Settings (stored in the `Setting` collection). They are never returned in full to the browser — only masked with the last 4 characters.

---

## 12. AI usage and cost control

- **Where Claude is used:** (1) generating scorecards from a JD, (2) scoring résumés against criteria, (3) scoring questionnaire answers, (4) scoring interview transcripts / artifacts, (5) AI-assist on form fields.
- **Model tiers:** `cheap`, `default`, `deep`, resolved to model IDs from `.env` (`CLAUDE_MODEL_CHEAP/DEFAULT/DEEP`) or Settings overrides (`claudeModelCheap/Default/Deep`). Each stage type maps to a tier through the `stageModelTiers` setting. **In the shipped defaults every stage type is mapped to `cheap`**; an admin can move any stage to a higher tier without a redeploy.
- **Cost table** (setting `aiCostRateTable`, USD per 1M tokens, editable): cheap 0.80 in / 4.00 out, default 3.00 / 15.00, deep 15.00 / 75.00. Verify against current Anthropic pricing.
- **Spend cap:** monthly total tracked in `Setting.aiMonthlySpend` (`{"YYYY-MM": usd}`). A one-time Slack warning at `aiSpendWarnPercent` (default 80%); at 100% of `monthlyAiSpendCapUsd` (default $200) calls are blocked with HTTP 402 until next month.
- **Per-interview accounting:** `aiTokensUsed` and `aiCostUsd` accumulate across re-scores.
- **Guardrails:** AI output must be valid JSON (one retry); scores keyed by `attributeId`; AI scores are *proposals* only.

---

## 13. Authentication, roles and security

- **Login:** bcrypt-hashed passwords; JWT signed with `JWT_SECRET`; sent as a Bearer token. `requireAuth` re-loads the user on every request (inactive users are rejected) and rejects tokens issued before `passwordChangedAt`.
- **Roles:** `admin`, `hiring_manager`, `recruiter`, `interviewer`. **Currently only the `admin` role is enforced**, on the write endpoints of Settings (`PUT /settings/:key`, `POST /settings/test-api`). All other authenticated routes are available to any logged-in user — full RBAC is a planned item.
- **Public surface (deliberately small):** job info + apply, candidate availability, Google OAuth callback, auth endpoints, health. Apply is protected by Turnstile, PDF-only/5 MB validation and duplicate detection.
- **Hardening in place:** Helmet headers; strict CORS allow-list; secrets masked in API responses; password-reset tokens hashed with a short TTL; phone/email validation; Cloudinary for uploads (no local disk); candidate **consent** gate before AI processing of transcripts; no wildcard CORS.
- **Production advice:** serve over HTTPS (the nginx template notes this), use a long random `JWT_SECRET`, change the seeded admin password immediately, use a Gmail App Password (never the real password).

---

## 14. Data retention and audit trail

**Retention** (`retentionService`): runs once at server start and then every 24 h. For each requisition with `status = closed` and `closedAt` older than `transcriptRetentionDays` (default 90; `0` = never delete) it purges, per interview: transcript text, the uploaded artifact (also deleted from Cloudinary) and each score's `aiJustification`. **Numeric scores, averages, dispositions, decisions and the audit log are kept permanently.** Each purge writes a `retention_purge` audit entry.

**Audit log:** one append-only row per meaningful action (see action list in §7) including who, what, old/new value and a reason. Viewable and filterable at `/audit-log`. Score overrides require a reason; initial-screening overrides require ≥10 characters.

---

## 15. Configuration

### Server environment variables (`.env` in the **repo root**; see `.env.example`)
| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | Server port (5000) / environment |
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` | JWT signing secret |
| `PASSWORD_RESET_TTL_MINUTES` | Reset-link lifetime (5–120, default 30) |
| `CLIENT_URL` | Allowed frontend origin(s), comma-separated; first is used in Slack/email links |
| `REGISTERED_OFFICE_LOCATIONS` | `\|`-separated office list for onsite/hybrid jobs |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL_CHEAP/DEFAULT/DEEP` | Claude access + model IDs |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_TIME_ZONE`, `GOOGLE_CALENDAR_HOST_EMAIL` | Google Meet/Calendar |
| `ACTIVE_TRANSCRIPT_PROVIDER` | `google_meet` (default) |
| `SLACK_WEBHOOK_URL` | Slack notifications |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | File storage |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Outgoing email |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | CAPTCHA (optional) |
| `DEFAULT_HIRE_THRESHOLD` (3.5), `DEFAULT_MAYBE_THRESHOLD` (3.0) | Scoring defaults |
| `TRANSCRIPT_RETENTION_DAYS` (90) | Retention window |
| `MONTHLY_AI_SPEND_CAP_USD` (200), `AI_SPEND_WARN_PERCENT` (80) | Spend controls |
| `SEED_ADMIN_NAME/EMAIL/PASSWORD` | Seeded admin account |

### Client environment variables (`client/.env`)
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Full API URL, e.g. `http://localhost:5000/api`. **Baked in at build time** — rebuild after changing. |
| `VITE_EMAILJS_SERVICE_ID/TEMPLATE_ID/PUBLIC_KEY` | Optional browser email fallback |
| Turnstile site key | The public apply page needs the site key to render the CAPTCHA widget (see `CandidateApply.jsx` for the exact variable it reads) |

### Runtime settings (collection `Setting`, editable in Settings UI)
`hireThreshold`, `maybeThreshold`, `transcriptRetentionDays`, `monthlyAiSpendCapUsd`, `aiSpendWarnPercent`, `activeTranscriptProvider`, `stageModelTiers`, `aiCostRateTable`, `claudeModelCheap/Default/Deep`, `aiMonthlySpend` (system-maintained), plus the credential overrides listed in §11. Runtime Setting values take priority over `.env`.

---

## 16. Local setup and running

**Prerequisites:** Node.js 18+, MongoDB 6+ (local or Atlas), an Anthropic API key. Optional: Google Cloud project, Slack webhook, Cloudinary, Gmail App Password, Turnstile keys.

```bash
# 1. Install (root has dev tooling; server and client have their own package.json)
npm install
cd server && npm install
cd ../client && npm install

# 2. Configure
cp .env.example .env              # in the repo root – fill in values
cp client/.env.example client/.env

# 3. Seed defaults (admin user, default pipeline, default settings)
npm run seed

# 4. Run both apps with hot reload
npm run dev
```

| Script (root) | Action |
|---|---|
| `npm run dev` | server (nodemon) + client (Vite) together |
| `npm run server` / `server:dev` | API only (plain / nodemon) |
| `npm run client` | Vite dev server only |
| `npm run client:build` | Production build of the frontend → `client/dist` |
| `npm run seed` | Run `server/seeds/seedDefaults.js` |

URLs: frontend `http://localhost:5173`, API `http://localhost:5000`, health `http://localhost:5000/api/health`. Log in with the `SEED_ADMIN_*` credentials, then change the password.

**Seed script** is idempotent: it creates the admin user, the default "Standard Hiring Stages" template and default Settings only if they don't already exist. (It also references demo users for the other roles.)

**Getting a Google refresh token:** authorise the OAuth client with the three scopes in §11 (via OAuth Playground, or the app's own `/api/interviews/google/callback` flow — the token is logged server-side, not returned to the browser), then store it as `GOOGLE_REFRESH_TOKEN` or in Settings.

---

## 17. Deployment

- **Frontend:** build with `npm run client:build` and host the static `client/dist` (Vercel config provided: all paths rewrite to `index.html` for the SPA router). Set `VITE_API_URL` at build time.
- **Backend:** any Node host (the code mentions Render). Set all env vars, and put the frontend origin(s) in `CLIENT_URL` (comma-separate production + preview URLs). Because disk is ephemeral, files must stay on Cloudinary.
- **Self-hosting (e.g. EC2):** use [nginx.conf.example](nginx.conf.example) — serves `client/dist` with SPA fallback and reverse-proxies `/api` to `localhost:5000`; add HTTPS with certbot before using real candidate data. Note that the template comments assume a relative `/api` base URL, whereas the current client reads `VITE_API_URL`; set it to `/api` for same-origin nginx hosting.
- **Operational notes:** the retention job runs inside the API process (`setInterval`) — it needs the server to be running at least once a day; logs go to `server/logs/`.

---