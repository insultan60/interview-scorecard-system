const crypto = require('crypto');
const mongoose = require('mongoose');
const Requisition = require('../models/Requisition');
const PipelineTemplate = require('../models/PipelineTemplate');
const Scorecard = require('../models/Scorecard');
const Application = require('../models/Application');
const Candidate = require('../models/Candidate');
const Setting = require('../models/Setting');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { asyncHandler, normalizeWeights } = require('../utils/helpers');
const { ValidationError } = require('../utils/errors');
const { assertRequisitionOpen, assertRequisitionConfigurable } = require('../utils/requisitionStatus');
const { generateScorecard } = require('../services/questionGenerator');
const { scoreInterview } = require('../services/aiScorer');
const { computeStageAverage, isStagePassed, rankApplications } = require('../services/scoringEngine');
const { uploadBuffer } = require('../config/cloudinary');
const { callClaude, getModelIds } = require('../services/claudeClient');
const emailNotifier = require('../services/emailNotifier');
const { getCaptchaConfig, verifyCaptcha } = require('../services/captchaService');
const { destroyFileIfUnreferenced } = require('../services/fileReferenceCleanup');

const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'];

/** Office locations are configured as a pipe-separated environment variable. */
function getRegisteredOfficeLocations() {
  return (process.env.REGISTERED_OFFICE_LOCATIONS || '')
    .split('|')
    .map((location) => location.trim())
    .filter(Boolean);
}

/** Builds the structured and display location values for a requisition. */
function resolveWorkplace({ workplaceType, officeLocation, remoteRegion }, current = {}) {
  const type = workplaceType ?? current.workplaceType ?? 'remote';
  if (!WORKPLACE_TYPES.includes(type)) {
    throw new ValidationError(['workplaceType'], 'Work arrangement must be onsite, hybrid, or remote.');
  }

  const offices = getRegisteredOfficeLocations();
  const selectedOffice = String(officeLocation ?? current.officeLocation ?? '').trim();
  const selectedRegion = String(remoteRegion ?? current.remoteRegion ?? '').trim();

  if (type === 'onsite') {
    const primaryOffice = offices[0];
    if (!primaryOffice) {
      throw new ValidationError(
        ['officeLocation'],
        'A registered office location must be configured before creating an onsite requisition.'
      );
    }
    return {
      workplaceType: type,
      officeLocation: primaryOffice,
      remoteRegion: '',
      location: `Onsite — ${primaryOffice}`,
    };
  }

  if (type === 'hybrid') {
    if (!offices.length) {
      throw new ValidationError(
        ['officeLocation'],
        'A registered office location must be configured before creating a hybrid requisition.'
      );
    }
    if (!selectedOffice) {
      throw new ValidationError(['officeLocation'], 'Please select an office location for a hybrid requisition.');
    }
    if (!offices.includes(selectedOffice)) {
      throw new ValidationError(['officeLocation'], 'Please select a registered office location for a hybrid requisition.');
    }
    return {
      workplaceType: type,
      officeLocation: selectedOffice,
      remoteRegion: '',
      location: `Hybrid — ${selectedOffice}`,
    };
  }

  return {
    workplaceType: type,
    officeLocation: '',
    remoteRegion: selectedRegion,
    location: selectedRegion ? `Remote — ${selectedRegion}` : 'Remote',
  };
}

const EMPLOYMENT_DETAIL_FIELDS = {
  full_time: 'fullTimeDetails',
  part_time: 'partTimeDetails',
  contract: 'contractDetails',
  internship: 'internshipDetails',
  temporary: 'temporaryDetails',
};

function normalizeEmploymentDetails(employmentType, raw) {
  const details = raw && typeof raw === 'object' ? raw : {};
  if (employmentType === 'full_time') {
    return { workingHours: String(details.workingHours || '').trim() };
  }
  if (employmentType === 'part_time') {
    return {
      weeklyHours: String(details.weeklyHours || '').trim(),
      workingHours: String(details.workingHours || '').trim(),
    };
  }
  if (employmentType === 'contract') {
    return {
      duration: String(details.duration || '').trim(),
      workingHours: String(details.workingHours || '').trim(),
      paymentRate: String(details.paymentRate || '').trim(),
    };
  }
  if (employmentType === 'internship') {
    return {
      duration: String(details.duration || '').trim(),
      paidStatus: String(details.paidStatus ?? 'paid').trim(),
      workingHours: String(details.workingHours || '').trim(),
    };
  }
  return {
    startDate: details.startDate ? new Date(details.startDate) : null,
    endDate: details.endDate ? new Date(details.endDate) : null,
    workingHours: String(details.workingHours || '').trim(),
  };
}

function validateEmploymentDetails(employmentType, details, missingFields) {
  if (employmentType === 'full_time') {
    if (!details.workingHours) missingFields.push('full-time working hours');
    return;
  }
  if (employmentType === 'part_time') {
    if (!details.weeklyHours) missingFields.push('part-time weekly hours');
    if (!details.workingHours) missingFields.push('part-time working hours');
    return;
  }
  if (employmentType === 'contract') {
    if (!details.duration) missingFields.push('contract duration');
    if (!details.workingHours) missingFields.push('contract working hours');
    if (!details.paymentRate) missingFields.push('contract payment/rate');
    return;
  }
  if (employmentType === 'internship') {
    if (!details.duration) missingFields.push('internship duration');
    if (!['paid', 'unpaid'].includes(details.paidStatus)) missingFields.push('internship paid status (paid or unpaid)');
    if (!details.workingHours) missingFields.push('internship working hours');
    return;
  }
  if (!details.startDate || Number.isNaN(details.startDate.getTime())) missingFields.push('temporary role start date');
  if (!details.endDate || Number.isNaN(details.endDate.getTime())) missingFields.push('temporary role end date');
  if (details.startDate && details.endDate && details.endDate < details.startDate) {
    missingFields.push('temporary end date (must be after start date)');
  }
  if (!details.workingHours) missingFields.push('temporary role working hours');
}

/** Reads a Setting's scalar value, falling back to a default if missing. */
async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key });
  return setting?.value ?? fallback;
}

/** Normalizes raw questionnaire inputs into objects { question, idealAnswer }. */
function normalizeQuestionnaire(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') {
        return { question: item.trim(), idealAnswer: '' };
      }
      if (typeof item === 'object' && item !== null) {
        return {
          question: (item.question || '').trim(),
          idealAnswer: (item.idealAnswer || '').trim(),
        };
      }
      return null;
    }).filter((item) => item && item.question);
  }
  if (typeof raw === 'string') {
    return raw.split('\n').map((q) => q.trim()).filter(Boolean).map((q) => ({
      question: q,
      idealAnswer: '',
    }));
  }
  return [];
}

/** Normalizes raw screening criteria inputs into objects { criteria, requirement }. */
function normalizeInitialScreeningCriteria(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') {
        return { criteria: item.trim(), requirement: '' };
      }
      if (typeof item === 'object' && item !== null) {
        return {
          criteria: (item.criteria || '').trim(),
          requirement: (item.requirement || '').trim(),
        };
      }
      return null;
    }).filter((item) => item && (item.criteria || item.requirement));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return trimmed.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => ({
      criteria: line,
      requirement: '',
    }));
  }
  return [];
}

/** A date-only application deadline remains open through the whole UTC day. */
function hasApplicationDeadlinePassed(deadline) {
  if (!deadline) return false;
  const date = new Date(deadline);
  const nextDayStartUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  );
  return Date.now() >= nextDayStartUtc;
}

/** Uses each application question and its ideal answer as the HR-screen rubric. */
function syncHrQuestionnaireRubric(scorecard, requisition) {
  const hrStage = scorecard?.stages?.find((stage) => stage.stageKey === 'hr_screen');
  if (!hrStage) return false;

  const attributes = (requisition.questionnaire || []).map((item, index) => {
    const question = typeof item === 'string' ? item : item.question;
    const idealAnswer = typeof item === 'object' ? item.idealAnswer : '';
    return {
      attributeId: `hr_screen_question_${index + 1}`,
      name: `Question ${index + 1}`,
      question,
      anchor5: idealAnswer || 'Fully addresses the question with a relevant, specific answer.',
      redFlags: 'Does not answer the question, or provides an unclear or irrelevant response.',
    };
  });

  if (JSON.stringify(hrStage.attributes) === JSON.stringify(attributes)) return false;
  hrStage.attributes = attributes;
  return true;
}

function assignMissingAttributeIds(stages) {
  stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      if (!attr.attributeId) {
        attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
      }
    });
  });
}

/**
 * POST /api/requisitions
 * Creates a requisition, snapshotting the chosen pipeline template's stages
 * so later template edits never mutate an already-open requisition.
 */
const create = asyncHandler(async (req, res) => {
  const {
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    workplaceType, officeLocation, remoteRegion, jobDescription, pipelineTemplateId, hireThreshold, maybeThreshold,
    initialScreeningCriteria, questionnaire, applicationDeadline, aiScreeningEnabled, status,
  } = req.body;

  const missingFields = [];
  if (!title || !title.trim()) missingFields.push('title');
  if (!employmentType) missingFields.push('employmentType');
  if (!workplaceType) missingFields.push('workplaceType');
  if (!jobDescription || !jobDescription.trim()) missingFields.push('jobDescription');
  if (!applicationDeadline) missingFields.push('applicationDeadline');
  if (!pipelineTemplateId) missingFields.push('pipelineTemplateId');

  const employmentDetailInputs = { fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails };
  const employmentDetailField = EMPLOYMENT_DETAIL_FIELDS[employmentType];
  const normalizedEmploymentDetails = normalizeEmploymentDetails(employmentType, employmentDetailInputs[employmentDetailField]);
  if (employmentDetailField) validateEmploymentDetails(employmentType, normalizedEmploymentDetails, missingFields);

  const normalizedCriteria = normalizeInitialScreeningCriteria(initialScreeningCriteria);
  if (normalizedCriteria.length === 0) {
    missingFields.push('initialScreeningCriteria');
  } else {
    for (let i = 0; i < normalizedCriteria.length; i++) {
      const c = normalizedCriteria[i];
      if (!c.criteria || !c.requirement) {
        missingFields.push(`initialScreeningCriteria item #${i + 1} (criteria & requirement details)`);
      }
    }
  }

  const normalizedQuestions = normalizeQuestionnaire(questionnaire);
  if (normalizedQuestions.length === 0) {
    missingFields.push('questionnaire');
  } else {
    for (let i = 0; i < normalizedQuestions.length; i++) {
      const q = normalizedQuestions[i];
      if (!q.question || !q.idealAnswer) {
        missingFields.push(`questionnaire item #${i + 1} (question & ideal answer benchmark)`);
      }
    }
  }

  if (missingFields.length > 0) {
    throw new ValidationError(missingFields, `Please fill out all required fields: ${missingFields.join(', ')}.`);
  }
  if (status !== undefined && !['open', 'paused', 'closed', 'draft'].includes(status)) {
    throw new ValidationError(['status'], 'status must be open, paused, closed, or draft.');
  }
  const workplace = resolveWorkplace({ workplaceType, officeLocation, remoteRegion });

  const template = await PipelineTemplate.findById(pipelineTemplateId);
  if (!template) {
    throw new ValidationError(['pipelineTemplateId'], 'No pipeline template found with that id.');
  }
  const pipelineTemplateName = template.name;

  const stages = template.stages.map((s) => ({
    key: s.key, label: s.label, stageType: s.stageType, inputType: s.inputType,
    enabled: s.enabled, order: s.order, weight: s.weight, passThreshold: s.passThreshold,
  }));

  const defaultHire = await getSettingValue('hireThreshold', 3.5);
  const defaultMaybe = await getSettingValue('maybeThreshold', 3.0);

  const requisition = await Requisition.create({
    title,
    employmentType: employmentType || 'full_time',
    ...(employmentDetailField ? { [employmentDetailField]: normalizedEmploymentDetails } : {}),
    ...workplace,
    jobDescription,
    pipelineTemplateId,
    pipelineTemplateName,
    stages,
    hireThreshold: hireThreshold ?? defaultHire,
    maybeThreshold: maybeThreshold ?? defaultMaybe,
    initialScreeningCriteria: normalizeInitialScreeningCriteria(initialScreeningCriteria),
    questionnaire: normalizeQuestionnaire(questionnaire),
    applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
    aiScreeningEnabled: aiScreeningEnabled !== undefined ? Boolean(aiScreeningEnabled) : true,
    status: status || 'open',
    closedAt: status === 'closed' ? new Date() : undefined,
    createdBy: req.user._id,
  });

  logger.info(`[Requisition] Created "${title}" (${requisition._id}) by user=${req.user._id}`);
  res.status(201).json({ requisition });
});

/**
 * GET /api/requisitions
 * Lists requisitions, optionally filtered by status (?status=open|paused|closed|draft).
 *
 * Each row carries a candidate rollup (total, still in progress, and the
 * hire/maybe/no-hire split) so the list can answer "which roles are actually
 * moving?" without the client fetching every requisition's detail separately.
 */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    // Include legacy `on_hold` records in the new Paused filter.
    filter.status = req.query.status === 'paused' ? { $in: ['paused', 'on_hold'] } : req.query.status;
  }
  const requisitions = await Requisition.find(filter).sort({ createdAt: -1 }).lean();

  const applications = await Application.find({ requisitionId: { $in: requisitions.map((r) => r._id) } })
    .select('requisitionId disposition')
    .lean();

  const statsByRequisition = new Map();
  applications.forEach((a) => {
    const key = String(a.requisitionId);
    if (!statsByRequisition.has(key)) {
      statsByRequisition.set(key, { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 });
    }
    const stats = statsByRequisition.get(key);
    stats.total += 1;
    if (a.disposition) stats[a.disposition] += 1;
    else stats.inProgress += 1;
  });

  res.json({
    registeredOfficeLocations: getRegisteredOfficeLocations(),
    requisitions: requisitions.map((r) => ({
      ...r,
      status: r.status === 'on_hold' ? 'paused' : r.status,
      candidateStats: statsByRequisition.get(String(r._id))
        || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 },
    })),
  });
});

/**
 * GET /api/requisitions/:id
 * Returns one requisition with its scorecard and current (persisted) ranking.
 */
const getOne = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job Opening not found.' });

  const scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : null;
  const applications = await Application.find({ requisitionId: requisition._id })
    .populate('candidateId', 'name email');

  applications.sort((a, b) => {
    if (a.rank === null || a.rank === undefined) return 1;
    if (b.rank === null || b.rank === undefined) return -1;
    return a.rank - b.rank;
  });

  const requisitionResponse = requisition.toObject();
  if (requisitionResponse.status === 'on_hold') requisitionResponse.status = 'paused';
  res.json({ requisition: requisitionResponse, scorecard, applications });
});

/**
 * PATCH /api/requisitions/:id
 * Updates title/JD/status/thresholds/stage weights. Closing a requisition
 * stamps closedAt (drives the retention purge). Weight edits are
 * auto-normalized to sum to 1 across enabled, scored stages and audited.
 */
const update = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const {
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    location, workplaceType, officeLocation, remoteRegion, jobDescription, status, hireThreshold, maybeThreshold, weights,
    initialScreeningCriteria, questionnaire, applicationDeadline, aiScreeningEnabled,
  } = req.body;

  const hasNonStatusChanges = [
    title, employmentType, fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails,
    location, workplaceType, officeLocation, remoteRegion, jobDescription, hireThreshold, maybeThreshold,
    weights, initialScreeningCriteria, questionnaire, applicationDeadline, aiScreeningEnabled,
  ].some((value) => value !== undefined);
  if (requisition.status === 'closed' && (status !== 'open' || hasNonStatusChanges)) {
    const error = new ValidationError(['status'], 'This requisition is closed and read-only. Reopen it before making changes.');
    error.statusCode = 409;
    throw error;
  }
  if (status !== undefined && !['open', 'paused', 'closed', 'draft'].includes(status)) {
    throw new ValidationError(['status'], 'status must be open, paused, closed, or draft.');
  }

  if (title !== undefined) requisition.title = title;
  if (employmentType !== undefined) requisition.employmentType = employmentType;
  const employmentDetailInputs = { fullTimeDetails, partTimeDetails, contractDetails, internshipDetails, temporaryDetails };
  const hasEmploymentDetailsChanges = Object.values(employmentDetailInputs).some((value) => value !== undefined);
  if (employmentType !== undefined || hasEmploymentDetailsChanges) {
    const nextEmploymentType = employmentType ?? requisition.employmentType;
    const employmentDetailField = EMPLOYMENT_DETAIL_FIELDS[nextEmploymentType];
    if (employmentDetailField) {
      const details = normalizeEmploymentDetails(
        nextEmploymentType,
        employmentDetailInputs[employmentDetailField] ?? requisition[employmentDetailField]
      );
      const missingFields = [];
      validateEmploymentDetails(nextEmploymentType, details, missingFields);
      if (missingFields.length) {
        throw new ValidationError(missingFields, `Please fill out all required fields: ${missingFields.join(', ')}.`);
      }
      Object.values(EMPLOYMENT_DETAIL_FIELDS).forEach((field) => { requisition[field] = undefined; });
      requisition[employmentDetailField] = details;
    }
  }
  const hasWorkplaceChanges = [workplaceType, officeLocation, remoteRegion].some((value) => value !== undefined);
  if (hasWorkplaceChanges) {
    Object.assign(requisition, resolveWorkplace({ workplaceType, officeLocation, remoteRegion }, requisition));
  } else if (location !== undefined) {
    // Keeps older API clients working while the UI uses structured workplace fields.
    requisition.location = location;
  }
  if (jobDescription !== undefined) requisition.jobDescription = jobDescription;
  if (hireThreshold !== undefined) requisition.hireThreshold = hireThreshold;
  if (maybeThreshold !== undefined) requisition.maybeThreshold = maybeThreshold;
  if (initialScreeningCriteria !== undefined) {
    requisition.initialScreeningCriteria = normalizeInitialScreeningCriteria(initialScreeningCriteria);
  }
  if (questionnaire !== undefined) {
    requisition.questionnaire = normalizeQuestionnaire(questionnaire);
  }
  if (applicationDeadline !== undefined) requisition.applicationDeadline = applicationDeadline ? new Date(applicationDeadline) : null;
  if (aiScreeningEnabled !== undefined) requisition.aiScreeningEnabled = Boolean(aiScreeningEnabled);

  let statusChange = null;
  if (status !== undefined && status !== requisition.status) {
    const oldStatus = requisition.status;
    requisition.status = status;
    if (status === 'closed') requisition.closedAt = new Date();
    if (status !== 'closed') requisition.closedAt = undefined;
    statusChange = { oldStatus, newStatus: status };
  }

  if (weights && typeof weights === 'object') {
    const oldWeights = {};
    requisition.stages.forEach((s) => { oldWeights[s.key] = s.weight; });

    const scoredKeys = requisition.stages
      .filter((s) => s.enabled && s.inputType !== 'pass_fail' && s.inputType !== 'status_only')
      .map((s) => s.key);
    const merged = {};
    scoredKeys.forEach((key) => { merged[key] = weights[key] !== undefined ? Number(weights[key]) : oldWeights[key]; });
    const normalized = normalizeWeights(merged);

    requisition.stages.forEach((s) => {
      if (normalized[s.key] !== undefined) s.weight = normalized[s.key];
    });

    await AuditLog.create({
      action: 'weight_change', userId: req.user._id, requisitionId: requisition._id,
      targetType: 'requisition', targetId: requisition._id.toString(),
      oldValue: oldWeights, newValue: normalized, reason: 'Stage weights updated via requisition edit.',
    });
  }

  await requisition.save();
  if (statusChange) {
    await AuditLog.create({
      action: 'requisition_status_change', userId: req.user._id, requisitionId: requisition._id,
      targetType: 'requisition', targetId: requisition._id.toString(),
      oldValue: statusChange.oldStatus, newValue: statusChange.newStatus,
      reason: `Requisition status changed from ${statusChange.oldStatus} to ${statusChange.newStatus}.`,
    });
  }
  logger.info(`[Requisition] Updated ${requisition._id} by user=${req.user._id}`);
  res.json({ requisition });
});

/**
 * DELETE /api/requisitions/:id
 * Deletes the requisition document only — does not cascade-delete
 * candidates/applications/interviews/audit history, since those are
 * historical records the system is designed to never silently lose.
 */
const remove = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionOpen(requisition, 'delete this requisition');
  await requisition.deleteOne();
  logger.info(`[Requisition] Deleted ${requisition._id} by user=${req.user._id}`);
  res.json({ message: 'Requisition deleted.' });
});

/**
 * POST /api/requisitions/:id/generate-scorecard
 * Calls questionGenerator to produce a role-specific rubric from the JD,
 * assigns a stable attributeId to each attribute, and saves/updates the
 * Scorecard (regenerating replaces the existing one, since HR may want a
 * fresh pass — already-scored interviews keep referencing their attributeIds
 * by value, so past scores are unaffected unless the same id is reused).
 */
const generateScorecardHandler = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'generate a scorecard');

  const generated = await generateScorecard(requisition);
  assignMissingAttributeIds(generated.stages);

  let scorecard;
  if (requisition.scorecardId) {
    scorecard = await Scorecard.findById(requisition.scorecardId);
  }
  if (scorecard) {
    scorecard.stages = generated.stages;
    scorecard.generatedByAI = true;
    await scorecard.save();
  } else {
    scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: true, stages: generated.stages });
    requisition.scorecardId = scorecard._id;
    await requisition.save();
  }

  logger.info(`[Requisition] Generated scorecard for ${requisition._id} (${generated.stages.length} stages).`);
  res.json({ scorecard });
});

/**
 * POST /api/requisitions/:id/clone-scorecard
 * Body: { sourceRequisitionId }. Copies another requisition's scorecard
 * stages/attributes verbatim onto this requisition (marked generatedByAI:false).
 */
const cloneScorecard = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'edit the scorecard');

  const { sourceRequisitionId } = req.body;
  if (!sourceRequisitionId) throw new ValidationError(['sourceRequisitionId'], 'sourceRequisitionId is required.');

  const sourceRequisition = await Requisition.findById(sourceRequisitionId);
  if (!sourceRequisition || !sourceRequisition.scorecardId) {
    throw new ValidationError(['sourceRequisitionId'], 'Source requisition has no scorecard to clone.');
  }
  const sourceScorecard = await Scorecard.findById(sourceRequisition.scorecardId);
  if (!sourceScorecard) throw new ValidationError(['sourceRequisitionId'], 'Source scorecard not found.');

  let scorecard;
  if (requisition.scorecardId) {
    scorecard = await Scorecard.findById(requisition.scorecardId);
    scorecard.stages = sourceScorecard.stages;
    scorecard.generatedByAI = false;
    await scorecard.save();
  } else {
    scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: false, stages: sourceScorecard.stages });
    requisition.scorecardId = scorecard._id;
    await requisition.save();
  }

  logger.info(`[Requisition] Cloned scorecard from ${sourceRequisitionId} onto ${requisition._id}.`);
  res.json({ scorecard });
});

/**
 * PATCH /api/requisitions/:id/scorecard
 * Persists manual edits made in ScorecardEditor: attribute text changes,
 * and added/removed attributes. Newly-added attributes (no attributeId
 * yet) get one assigned server-side, same scheme as generate-scorecard.
 * Not in INSTRUCTIONS.md's original route table — added because the
 * frontend spec explicitly requires ScorecardEditor to "save" edits, and
 * generate-scorecard/clone-scorecard only ever overwrite from AI/another
 * requisition, never persist arbitrary manual edits.
 */
const updateScorecard = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
  assertRequisitionConfigurable(requisition, 'edit the scorecard');
  if (!requisition.scorecardId) {
    throw new ValidationError(['scorecardId'], 'This requisition has no scorecard yet — generate one first.');
  }

  const { stages } = req.body;
  if (!Array.isArray(stages)) {
    throw new ValidationError(['stages'], 'stages must be an array.');
  }

  const scorecard = await Scorecard.findById(requisition.scorecardId);
  const oldStages = scorecard.stages;

  stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      if (!attr.attributeId) {
        attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
      }
    });
  });

  scorecard.stages = stages;
  await scorecard.save();

  await AuditLog.create({
    action: 'question_edit', userId: req.user._id, requisitionId: requisition._id,
    targetType: 'scorecard', targetId: scorecard._id.toString(),
    oldValue: oldStages, newValue: scorecard.stages, reason: 'Scorecard manually edited via ScorecardEditor.',
  });

  logger.info(`[Requisition] Scorecard manually updated for ${requisition._id}.`);
  res.json({ scorecard });
});

/**
 * GET /api/requisitions/:id/ranking
 * Returns the persisted ranking (weightedTotal/disposition/rank) for every
 * application under this requisition. These values are computed and
 * persisted by scoringController.recompute — this endpoint just reads them.
 */
const ranking = asyncHandler(async (req, res) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const applications = await Application.find({ requisitionId: requisition._id }).populate('candidateId', 'name email');
  const ranked = rankApplications(applications.map((a) => a.toObject()));
  ranked.sort((a, b) => {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });

  res.json({ ranking: ranked });
});

/**
 * POST /api/requisitions/generate-field
 * Uses Anthropic Claude AI to auto-generate content for jobDescription,
 * initialScreeningCriteria, or questionnaire based on title and optional prompt context.
 */
const generateField = asyncHandler(async (req, res) => {
  const { fieldType, title, jobDescription, prompt: userPromptText } = req.body;
  if (!fieldType || !title) {
    throw new ValidationError(['fieldType', 'title'], 'fieldType and title are required.');
  }

  const modelIds = await getModelIds();
  const cheapModel = modelIds.cheap;

  let systemPrompt = '';
  let userPrompt = '';
  let expectJson = false;

  if (fieldType === 'jobDescription') {
    systemPrompt = 'You are an expert HR recruiter creating comprehensive, professional Job Descriptions.';
    userPrompt = `Generate a detailed, professional Job Description for the position: "${title}". ${userPromptText ? `Additional instructions/context: ${userPromptText}` : ''}`;
  } else if (fieldType === 'initialScreeningCriteria') {
    expectJson = true;
    systemPrompt = 'You are an expert HR Screener defining clear, objective initial screening criteria categories and detailed requirements extracted directly from the Job Description.';
    userPrompt = `Based on the following Job Description for "${title}", generate 4 to 6 specific initial screening criteria categories (e.g., Experience, Portfolio/Reel, Software Proficiency, Education, Availability, Key Competencies) and their exact requirements.

Job Description:
${jobDescription || title}
${userPromptText ? `Additional instructions: ${userPromptText}\n` : ''}
Respond ONLY in JSON format matching this exact shape:
{
  "criteriaList": [
    { "criteria": "Experience", "requirement": "1–2 years in video editing (agency, in-house, or freelance)" },
    { "criteria": "Portfolio/Reel", "requirement": "Must submit a demo reel or portfolio link" },
    { "criteria": "Software Proficiency", "requirement": "Adobe Premiere Pro (required), After Effects (preferred)" },
    { "criteria": "Education", "requirement": "Bachelor's degree or equivalent practical experience" },
    { "criteria": "Availability", "requirement": "Immediate joiner preferred / notice period acceptable" }
  ]
}`;
  } else if (fieldType === 'questionnaire') {
    expectJson = true;
    systemPrompt = 'You are an expert HR recruiter generating relevant application questionnaire questions and 5-star scoring benchmarks derived directly from the Job Description.';
    userPrompt = `Based on the following Job Description for "${title}", generate 4 to 6 relevant application questionnaire questions for candidates, along with target ideal answers (5-star benchmarks).

Job Description:
${jobDescription || title}
${userPromptText ? `Additional instructions: ${userPromptText}\n` : ''}
Respond ONLY in JSON format matching this exact shape:
{
  "questions": [
    {
      "question": "Question text...",
      "idealAnswer": "Ideal 5-star benchmark answer..."
    }
  ]
}`;
  } else {
    throw new ValidationError(['fieldType'], 'Invalid fieldType specified.');
  }

  const result = await callClaude({
    model: cheapModel,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    expectJson,
  });

  if (expectJson) {
    const parsed = JSON.parse(result.text);
    if (fieldType === 'initialScreeningCriteria') {
      return res.json({ criteria: normalizeInitialScreeningCriteria(parsed.criteriaList || parsed.criteria || parsed.items) });
    }
    return res.json({ questions: normalizeQuestionnaire(parsed.questions) });
  }

  res.json({ content: result.text.trim() });
});

/**
 * GET /api/requisitions/:id/public
 * Public endpoint returning open requisition details for candidates.
 */
const getPublic = asyncHandler(async (req, res) => {
  logger.info(`[Requisition] Public GET request for ID: "${req.params.id}"`);

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    logger.warn(`[Requisition] Public GET failed: "${req.params.id}" is not a valid ObjectId`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  const requisition = await Requisition.findById(req.params.id)
    .select('title employmentType fullTimeDetails partTimeDetails contractDetails internshipDetails temporaryDetails location workplaceType officeLocation remoteRegion jobDescription initialScreeningCriteria questionnaire applicationDeadline aiScreeningEnabled status createdAt')
    .lean();

  if (!requisition) {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" not found in database`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  if (requisition.status !== 'open') {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" status is "${requisition.status}" (must be "open")`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  const isExpired = hasApplicationDeadlinePassed(requisition.applicationDeadline);

  logger.info(`[Requisition] Public GET success: Found open requisition "${requisition.title}" (${requisition._id})`);

  res.json({
    requisition: {
      ...requisition,
      isExpired,
    },
    captcha: (() => {
      const { enabled, siteKey } = getCaptchaConfig();
      return { enabled, siteKey: enabled ? siteKey : undefined };
    })(),
  });
});

/**
 * POST /api/requisitions/:id/apply
 * Public endpoint for candidate self-application submission with resume upload.
 */
const applyPublic = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'This position is closed or no longer accepting applications.' });
  }

  const requisition = await Requisition.findById(req.params.id);
  if (!requisition || requisition.status !== 'open') {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'This position is closed or no longer accepting applications.' });
  }

  if (hasApplicationDeadlinePassed(requisition.applicationDeadline)) {
    return res.status(400).json({ error: 'EXPIRED', message: 'The application deadline for this position has passed.' });
  }

  const captchaResult = await verifyCaptcha(req.body?.captchaToken, req.ip);
  if (!captchaResult.valid) {
    return res.status(400).json({
      error: 'CAPTCHA_FAILED',
      message: 'Please complete the security check and submit your application again.',
    });
  }

  const { name, email, phone, questionnaireAnswers } = req.body;
  if (!name || !email) {
    throw new ValidationError(['name', 'email'], 'Name and email are required to apply.');
  }
  if (!PHONE_NUMBER_PATTERN.test(String(phone || '').trim())) {
    throw new ValidationError(['phone'], 'Phone number must contain exactly 11 digits.');
  }

  let parsedQAnswers = {};
  if (typeof questionnaireAnswers === 'string') {
    try { parsedQAnswers = JSON.parse(questionnaireAnswers); } catch (e) { parsedQAnswers = {}; }
  } else if (typeof questionnaireAnswers === 'object' && questionnaireAnswers !== null) {
    parsedQAnswers = questionnaireAnswers;
  }
  const unansweredQuestions = (requisition.questionnaire || []).filter((question) => {
    const questionText = typeof question === 'string' ? question : question.question;
    return !String(parsedQAnswers[questionText] || '').trim();
  });
  if (unansweredQuestions.length > 0) {
    throw new ValidationError(['questionnaireAnswers'], 'Please answer every screening question before submitting your application.');
  }
  if (!req.file) {
    throw new ValidationError(['resume'], 'A PDF resume is required to apply.');
  }
  const isPdfResume = req.file.mimetype === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf');
  if (!isPdfResume) {
    throw new ValidationError(['resume'], 'Resume must be a PDF file.');
  }
  if (req.file.size > 5 * 1024 * 1024) {
    throw new ValidationError(['resume'], 'Resume must be 5 MB or smaller.');
  }

  const cleanEmail = email.toLowerCase().trim();

  // 1. Check if candidate already exists AND has an application for this requisition BEFORE uploading to Cloudinary
  let candidate = await Candidate.findOne({ email: cleanEmail });
  if (candidate) {
    const existingApp = await Application.findOne({ candidateId: candidate._id, requisitionId: requisition._id });
    if (existingApp) {
      return res.status(409).json({ error: 'DUPLICATE', message: 'You have already submitted an application for this position.' });
    }
  }

  // 2. Upload file to Cloudinary & extract text ONLY after verifying non-duplicate status
  let resumeFileUrl = '';
  let resumeFilePublicId = '';
  let candidateResumeFileUrl = '';
  let candidateResumeFilePublicId = '';
  let oldProfileResumeId = null;
  let resumeText = '';

  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'candidate-resumes',
      filename: `${Date.now()}-${req.file.originalname}`,
    });
    resumeFileUrl = uploaded.secureUrl;
    resumeFilePublicId = uploaded.publicId;

    // The candidate profile keeps a current CV, while this application keeps
    // its own immutable resume-screen artifact for historical review.
    const profileUpload = await uploadBuffer(req.file.buffer, {
      folder: 'candidate-resumes',
      filename: `${Date.now()}-profile-${req.file.originalname}`,
    });
    candidateResumeFileUrl = profileUpload.secureUrl;
    candidateResumeFilePublicId = profileUpload.publicId;

    try {
      const { extractArtifactText } = require('../utils/textExtractor');
      resumeText = await extractArtifactText(req.file.buffer, req.file.originalname);
    } catch (err) {
      logger.warn(`[ApplyPublic] Text extraction failed for file ${req.file.originalname}: ${err.message}`);
    }
  }

  // 3. Create or update candidate record with the new CV upload
  if (!candidate) {
    candidate = await Candidate.create({
      name,
      email: cleanEmail,
      phone: phone.trim(),
      resumeFileUrl: candidateResumeFileUrl,
      resumeFilePublicId: candidateResumeFilePublicId,
    });
  } else {
    if (candidateResumeFileUrl) {
      oldProfileResumeId = candidate.resumeFilePublicId;
      candidate.resumeFileUrl = candidateResumeFileUrl;
      candidate.resumeFilePublicId = candidateResumeFilePublicId;
    }
    candidate.phone = phone.trim();
    await candidate.save();
    if (oldProfileResumeId) {
      destroyFileIfUnreferenced(oldProfileResumeId)
        .catch((err) => logger.warn(`[ApplyPublic] Could not clean up old candidate résumé ${oldProfileResumeId}: ${err.message}`));
    }
  }

  // 1. Ensure Scorecard exists for this requisition (auto-generate if missing)
  let scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : await Scorecard.findOne({ requisitionId: requisition._id });
  if (!scorecard) {
    try {
      const generated = await generateScorecard(requisition);
      assignMissingAttributeIds(generated.stages);
      scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: true, stages: generated.stages });
      requisition.scorecardId = scorecard._id;
      await requisition.save();
      logger.info(`[ApplyPublic] Auto-generated missing scorecard for requisition ${requisition._id}`);
    } catch (scErr) {
      logger.warn(`[ApplyPublic] Could not auto-generate scorecard for requisition ${requisition._id}: ${scErr.message}`);
    }
  }
  if (scorecard && syncHrQuestionnaireRubric(scorecard, requisition)) {
    scorecard.markModified('stages');
    await scorecard.save();
  }

  // 2. Create Application document
  const enabledStages = (requisition.stages || []).filter((s) => s.enabled);
  // Public applications always begin with the required résumé screen, even
  // for a requisition created from an older pipeline template.
  const firstStage = enabledStages.find((stage) => stage.key === 'resume_screen')
    || enabledStages[0]
    || requisition.stages[0];
  const firstStageKey = firstStage ? firstStage.key : null;
  const hrStage = enabledStages.find((stage) => stage.key === 'hr_screen');

  const stageProgress = (requisition.stages || []).map((s) => ({
    stageKey: s.key,
    status: 'pending',
    stageAverage: null,
    passed: null,
  }));

  let application = await Application.create({
    candidateId: candidate._id,
    requisitionId: requisition._id,
    currentStageKey: firstStageKey,
    source: 'public_link',
    stageProgress,
    questionnaireAnswers: parsedQAnswers,
  });

  // 3. Create Stage 1 Interview document
  const Interview = require('../models/Interview');
  let firstInterview = null;
  let hrInterview = null;
  if (firstStageKey) {
    firstInterview = await Interview.create({
      applicationId: application._id,
      requisitionId: requisition._id,
      stageKey: firstStageKey,
      meetingMode: 'online',
      provider: 'google_meet',
      status: 'pending',
      artifactFileUrl: resumeFileUrl,
      artifactFilePublicId: resumeFilePublicId,
      transcriptText: resumeText,
    });

    const progressItem = application.stageProgress.find((p) => p.stageKey === firstStageKey);
    if (progressItem) {
      progressItem.status = 'scheduled';
    }
  }

  // The HR questionnaire screen is created for every public application,
  // even when the résumé screen later fails its gate. It is a separate
  // automated evaluation and never includes the candidate's CV.
  if (hrStage && hrStage.key !== firstStageKey) {
    const questionnaireTranscript = (requisition.questionnaire || []).map((question, index) => {
      const questionText = typeof question === 'string' ? question : question.question;
      return `Question ${index + 1}: ${questionText}\nCandidate Answer: ${parsedQAnswers[questionText] || ''}`;
    }).join('\n\n');
    hrInterview = await Interview.create({
      applicationId: application._id,
      requisitionId: requisition._id,
      stageKey: hrStage.key,
      meetingMode: 'online',
      provider: 'google_meet',
      status: 'pending',
      transcriptText: questionnaireTranscript,
    });
    const hrProgress = application.stageProgress.find((progress) => progress.stageKey === hrStage.key);
    if (hrProgress) hrProgress.status = 'scheduled';
    await application.save();
  }

  // 4. Score the résumé stage using only the CV, JD, and screening criteria.
  let aiScore = null;
  let passed = null;
  if (firstInterview && scorecard && firstStage) {
    const stageRubric = scorecard.stages.find((s) => s.stageKey === firstStageKey);
    if (stageRubric && stageRubric.attributes && stageRubric.attributes.length > 0 && resumeText) {
      try {
        logger.info(`[ApplyPublic] Auto-scoring Stage 1 (${firstStageKey}) interview for candidate application ${application._id}...`);
        const { interview: scoredInterview } = await scoreInterview({
          interview: firstInterview,
          stageType: firstStage.stageType,
          attributes: stageRubric.attributes,
          requisition,
          application,
        });
        if (scoredInterview) {
          firstInterview = scoredInterview;
          const progressItem = application.stageProgress.find((p) => p.stageKey === firstStageKey);
          if (progressItem) progressItem.status = 'scored';
          await application.save();
        }
      } catch (scoreErr) {
        logger.warn(`[ApplyPublic] Stage 1 auto-scoring warning: ${scoreErr.message}`);
      }
    }
  }

  // 5. Auto-approve résumé scores and compute the first-stage result.
  if (firstInterview && (firstInterview.status === 'scored' || (firstInterview.scores && firstInterview.scores.length > 0))) {
    try {
      firstInterview.scores.forEach((s) => {
        if (s.approvedScore === undefined || s.approvedScore === null) {
          s.approvedScore = s.aiScore;
        }
      });
      firstInterview.status = 'approved';
      firstInterview.markModified('scores');

      const stageAverage = computeStageAverage(firstInterview);
      const stagePassed = isStagePassed(stageAverage, firstStage.passThreshold);
      firstInterview.stageAverage = stageAverage;
      await firstInterview.save();

      aiScore = stageAverage;
      passed = stagePassed;
      application.initialScreening = {
        aiScore: stageAverage,
        aiJustification: firstInterview.scores.map((score) => score.aiJustification).filter(Boolean).join(' '),
        passed: stagePassed,
        overridden: false,
      };

      const progress = application.stageProgress.find((p) => p.stageKey === firstStageKey);
      if (progress) {
        progress.stageAverage = stageAverage;
        progress.passed = stagePassed;
        progress.status = stagePassed ? 'passed' : 'failed';
      }

      const { getOrCreateNextInterview, recomputeAndPersist } = require('./scoringController');
      let nextInterviewId = null;
      if (stagePassed) {
        nextInterviewId = await getOrCreateNextInterview(application, requisition, firstStageKey, null);
        await recomputeAndPersist(application, requisition, null, 'Auto-approved Stage 1 AI scoring upon public application submission.');
      } else {
        await recomputeAndPersist(application, requisition, null, 'Auto-computed results after Stage 1 failure.');
      }
      logger.info(`[ApplyPublic] Auto-approved Stage 1 (${firstStageKey}): stageAverage=${stageAverage}, passed=${stagePassed}, nextInterviewId=${nextInterviewId}`);
    } catch (approveErr) {
      logger.error(`[ApplyPublic] Auto-approval error: ${approveErr.message}`);
    }
  }

  // 6. Auto-score and approve the HR screen from questionnaire answers only.
  if (hrInterview && scorecard && hrStage) {
    const hrRubric = scorecard.stages.find((stage) => stage.stageKey === hrStage.key);
    if (hrRubric?.attributes?.length > 0) {
      try {
        const { interview: scoredInterview } = await scoreInterview({
          interview: hrInterview,
          stageType: hrStage.stageType,
          attributes: hrRubric.attributes,
          requisition,
          application,
        });
        hrInterview = scoredInterview;
        if (hrInterview.status === 'scored') {
          hrInterview.scores.forEach((score) => {
            if (score.approvedScore === undefined || score.approvedScore === null) {
              score.approvedScore = score.aiScore;
            }
          });
          hrInterview.status = 'approved';
          hrInterview.markModified('scores');
          const stageAverage = computeStageAverage(hrInterview);
          const stagePassed = isStagePassed(stageAverage, hrStage.passThreshold);
          hrInterview.stageAverage = stageAverage;
          await hrInterview.save();

          const progress = application.stageProgress.find((item) => item.stageKey === hrStage.key);
          if (progress) {
            progress.stageAverage = stageAverage;
            progress.passed = stagePassed;
            progress.status = stagePassed ? 'passed' : 'failed';
          }
          const { getOrCreateNextInterview, recomputeAndPersist } = require('./scoringController');
          // Continue to later pipeline stages only when both required public
          // application screens pass. HR is still scored when résumé fails.
          if (stagePassed && passed) {
            await getOrCreateNextInterview(application, requisition, hrStage.key, null);
          }
          await recomputeAndPersist(application, requisition, null, 'Auto-approved HR questionnaire scoring upon public application submission.');
        }
      } catch (scoreErr) {
        logger.warn(`[ApplyPublic] HR questionnaire scoring warning: ${scoreErr.message}`);
      }
    }
  }

  try {
    const allApps = await Application.find({ requisitionId: requisition._id });
    const ranked = rankApplications(allApps);
    for (const app of ranked) {
      await Application.updateOne({ _id: app._id }, { rank: app.rank });
    }
  } catch (rankErr) {
    logger.warn(`[ApplyPublic] Ranking error: ${rankErr.message}`);
  }

  // Confirmation email is best-effort: a mail configuration/delivery failure
  // must never undo an application that was already successfully submitted.
  let confirmationEmail = { sent: false, reason: 'Not attempted.' };
  try {
    confirmationEmail = await emailNotifier.sendApplicationConfirmationEmail({
      candidateEmail: candidate.email,
      candidateName: candidate.name,
      requisitionTitle: requisition.title,
    });
  } catch (emailErr) {
    confirmationEmail = { sent: false, reason: 'Could not send confirmation email.' };
    logger.warn(`[ApplyPublic] Confirmation email failed for application ${application._id}: ${emailErr.message}`);
  }

  logger.info(`[ApplyPublic] Application submitted for candidate "${name}" (${candidate._id}) on requisition "${requisition.title}". AI Screening Enabled=${requisition.aiScreeningEnabled}, Score=${aiScore}, Passed=${passed}, confirmationEmailSent=${confirmationEmail.sent}`);

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully! Your application is under review.',
    aiScreeningEnabled: requisition.aiScreeningEnabled,
    score: aiScore,
    passed,
    confirmationEmailSent: confirmationEmail.sent,
    application,
    interview: firstInterview,
  });
});

module.exports = {
  create, list, getOne, update, remove,
  generateScorecard: generateScorecardHandler,
  cloneScorecard,
  updateScorecard,
  ranking,
  generateField,
  getPublic,
  applyPublic,
};
