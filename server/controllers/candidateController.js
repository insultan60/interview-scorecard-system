const Candidate = require('../models/Candidate');
const Application = require('../models/Application');
const Interview = require('../models/Interview');
const AuditLog = require('../models/AuditLog');
const Requisition = require('../models/Requisition');
const logger = require('../utils/logger');
const { asyncHandler } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { assertRequisitionOpen } = require('../utils/requisitionStatus');
const { uploadBuffer, destroyFile } = require('../config/cloudinary');
const { destroyFileIfUnreferenced } = require('../services/fileReferenceCleanup');

const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK_IMPORT_ROWS = 500;

function validatePhone(phone, required = false) {
  const value = String(phone || '').trim();
  if ((required && !value) || (value && !PHONE_NUMBER_PATTERN.test(value))) {
    throw new ValidationError(['phone'], 'Phone number must contain exactly 11 digits.');
  }
  return value;
}

/**
 * GET /api/candidates — list all candidates, each with the requisitions it is
 * already attached to.
 *
 * The attachments are resolved here in two queries rather than left to the
 * client, which would otherwise need one request per requisition just to
 * answer "is this person already in a pipeline?" — and without that answer the
 * only way to find out is to attempt an attach and read the 409.
 */
const list = asyncHandler(async (req, res) => {
  const candidates = await Candidate.find().sort({ createdAt: -1 }).lean();

  const applications = await Application.find({ candidateId: { $in: candidates.map((c) => c._id) } })
    .select('candidateId requisitionId currentStageKey disposition')
    .lean();
  const requisitions = await Requisition.find({ _id: { $in: applications.map((a) => a.requisitionId) } })
    .select('title status')
    .lean();
  const requisitionById = new Map(requisitions.map((r) => [String(r._id), r]));

  const byCandidate = new Map();
  applications.forEach((a) => {
    const requisition = requisitionById.get(String(a.requisitionId));
    if (!requisition) return;
    const entry = {
      applicationId: a._id,
      requisitionId: a.requisitionId,
      title: requisition.title,
      status: requisition.status,
      currentStageKey: a.currentStageKey,
      disposition: a.disposition ?? null,
    };
    const key = String(a.candidateId);
    if (!byCandidate.has(key)) byCandidate.set(key, []);
    byCandidate.get(key).push(entry);
  });

  res.json({
    candidates: candidates.map((c) => ({ ...c, applications: byCandidate.get(String(c._id)) || [] })),
  });
});

/** POST /api/candidates — create a candidate; `resume` file field is optional (multer). */
const create = asyncHandler(async (req, res) => {
  const { name, email, phone, notes } = req.body;
  if (!name) throw new ValidationError(['name'], 'name is required.');
  const validatedPhone = validatePhone(phone);

  let resumeFileUrl;
  let resumeFilePublicId;
  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'resumes', filename: `${Date.now()}-${req.file.originalname}` });
    resumeFileUrl = uploaded.secureUrl;
    resumeFilePublicId = uploaded.publicId;
  }

  const candidate = await Candidate.create({
    name,
    email,
    phone: validatedPhone,
    notes,
    resumeFileUrl,
    resumeFilePublicId,
  });

  logger.info(`[Candidate] Created "${name}" (${candidate._id})${req.file ? ' with résumé' : ''}.`);
  res.status(201).json({ candidate });
});

/**
 * POST /api/candidates/bulk
 * Creates candidates parsed from a CSV preview. Each row is validated again
 * server-side so browser validation cannot create malformed or duplicate data.
 */
const bulkCreate = asyncHandler(async (req, res) => {
  const rows = req.body?.candidates;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ValidationError(['candidates'], 'At least one candidate row is required.');
  }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    throw new ValidationError(['candidates'], `A maximum of ${MAX_BULK_IMPORT_ROWS} candidates can be imported at once.`);
  }

  const existingCandidates = await Candidate.find({ email: { $exists: true, $ne: '' } }).select('email').lean();
  const existingEmails = new Set(existingCandidates
    .map((candidate) => String(candidate.email || '').trim().toLowerCase())
    .filter(Boolean));
  const fileEmails = new Set();
  const candidatesToCreate = [];
  const skipped = [];

  rows.forEach((row, index) => {
    const rowNumber = Number(row?.rowNumber) || index + 2;
    const name = String(row?.name || '').trim();
    const email = String(row?.email || '').trim();
    const phone = String(row?.phone || '').trim();
    const notes = String(row?.notes || '').trim();
    const errors = [];

    if (!name) errors.push('Name is required.');
    if (email && !EMAIL_PATTERN.test(email)) errors.push('Email address is invalid.');
    if (phone && !PHONE_NUMBER_PATTERN.test(phone)) errors.push('Phone number must contain exactly 11 digits.');

    const emailKey = email.toLowerCase();
    if (emailKey && existingEmails.has(emailKey)) errors.push('A candidate with this email already exists.');
    if (emailKey && fileEmails.has(emailKey)) errors.push('This email appears more than once in the import file.');

    if (errors.length > 0) {
      skipped.push({ rowNumber, errors });
      return;
    }

    if (emailKey) fileEmails.add(emailKey);
    candidatesToCreate.push({ name, email, phone, notes });
  });

  const created = candidatesToCreate.length > 0 ? await Candidate.insertMany(candidatesToCreate) : [];
  logger.info(`[Candidate] Bulk import: created=${created.length}, skipped=${skipped.length}.`);
  res.status(201).json({
    createdCount: created.length,
    skippedCount: skipped.length,
    skipped,
    candidates: created,
  });
});

/** GET /api/candidates/:id */
const getOne = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });
  res.json({ candidate });
});

/** PATCH /api/candidates/:id */
const update = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { name, email, phone, notes } = req.body;
  const oldValue = {
    name: candidate.name, email: candidate.email || '', phone: candidate.phone || '', notes: candidate.notes || '',
  };
  if (name !== undefined) {
    if (!String(name).trim()) throw new ValidationError(['name'], 'Name is required.');
    candidate.name = String(name).trim();
  }
  if (email !== undefined) {
    const cleanEmail = String(email).trim().toLowerCase();
    if (cleanEmail && !EMAIL_PATTERN.test(cleanEmail)) throw new ValidationError(['email'], 'Please enter a valid email address.');
    if (cleanEmail) {
      const duplicate = await Candidate.findOne({ email: cleanEmail, _id: { $ne: candidate._id } });
      if (duplicate) throw new ValidationError(['email'], 'Another candidate already uses this email address.');
    }
    candidate.email = cleanEmail;
  }
  if (phone !== undefined) candidate.phone = validatePhone(phone);
  if (notes !== undefined) candidate.notes = notes;

  let resumeReplaced = false;
  let replacedResumePublicId = null;
  if (req.file) {
    const oldPublicId = candidate.resumeFilePublicId;
    const uploaded = await uploadBuffer(req.file.buffer, { folder: 'resumes', filename: `${Date.now()}-${req.file.originalname}` });
    candidate.resumeFileUrl = uploaded.secureUrl;
    candidate.resumeFilePublicId = uploaded.publicId;
    resumeReplaced = true;
    replacedResumePublicId = oldPublicId;
  }

  await candidate.save();
  if (replacedResumePublicId) {
    destroyFileIfUnreferenced(replacedResumePublicId)
      .catch((err) => logger.warn(`[Candidate] Could not clean up old résumé ${replacedResumePublicId}: ${err.message}`));
  }
  await AuditLog.create({
    action: 'candidate_update', userId: req.user._id,
    targetType: 'candidate', targetId: candidate._id.toString(),
    oldValue, newValue: {
      name: candidate.name, email: candidate.email || '', phone: candidate.phone || '', notes: candidate.notes || '', resumeReplaced,
    },
    reason: 'Candidate profile updated.',
  });
  res.json({ candidate });
});

/**
 * POST /api/candidates/:id/apply
 * Attaches a candidate to a requisition, creating the Application record
 * every score will attach to. Refuses to create a duplicate Application for
 * the same candidate+requisition pair.
 */
const apply = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const { requisitionId } = req.body;
  if (!requisitionId) throw new ValidationError(['requisitionId'], 'requisitionId is required.');

  const requisition = await Requisition.findById(requisitionId);
  if (!requisition) throw new ValidationError(['requisitionId'], 'No requisition found with that id.');
  assertRequisitionOpen(requisition, 'attach a candidate');

  const existing = await Application.findOne({ candidateId: candidate._id, requisitionId });
  if (existing) {
    return res.status(409).json({
      error: 'VALIDATION_ERROR',
      message: 'This candidate already has an application for this job opening.',
      applicationId: existing._id,
    });
  }

  const enabledStages = requisition.stages.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const firstStageKey = enabledStages[0]?.key || null;

  const application = await Application.create({
    candidateId: candidate._id,
    requisitionId,
    currentStageKey: firstStageKey,
    source: 'manual',
    stageProgress: enabledStages.map((s) => ({ stageKey: s.key, status: 'pending' })),
  });

  logger.info(`[Candidate] ${candidate._id} applied to job ${requisitionId} -> application ${application._id}`);
  res.status(201).json({ application });
});

/**
 * DELETE /api/candidates/:id
 * Permanently removes the candidate and every record/evidence file owned by
 * their applications. Cloudinary files are deleted first so a storage failure
 * cannot leave an apparently-deleted candidate with personal files behind.
 */
const remove = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findById(req.params.id);
  if (!candidate) return res.status(404).json({ error: 'NOT_FOUND', message: 'Candidate not found.' });

  const applications = await Application.find({ candidateId: candidate._id }).select('_id').lean();
  const applicationIds = applications.map((application) => application._id);
  const interviews = await Interview.find({ applicationId: { $in: applicationIds } })
    .select('artifactFilePublicId')
    .lean();

  const fileIds = [...new Set([
    candidate.resumeFilePublicId,
    ...interviews.map((interview) => interview.artifactFilePublicId),
  ].filter(Boolean))];
  await Promise.all(fileIds.map((publicId) => destroyFile(publicId)));

  await AuditLog.deleteMany({ applicationId: { $in: applicationIds } });
  const interviewResult = await Interview.deleteMany({ applicationId: { $in: applicationIds } });
  const applicationResult = await Application.deleteMany({ _id: { $in: applicationIds } });
  await candidate.deleteOne();

  logger.info(`[Candidate] Permanently deleted ${candidate._id}: applications=${applicationResult.deletedCount}, interviews=${interviewResult.deletedCount}, cloudinaryFiles=${fileIds.length}.`);
  res.json({
    message: 'Candidate and all related records were deleted.',
    deleted: { applications: applicationResult.deletedCount, interviews: interviewResult.deletedCount, cloudinaryFiles: fileIds.length },
  });
});

module.exports = { list, create, bulkCreate, getOne, update, apply, remove };
