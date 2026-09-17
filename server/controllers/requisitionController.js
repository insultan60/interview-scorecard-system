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
const { generateScorecard } = require('../services/questionGenerator');
const { scoreInterview } = require('../services/aiScorer');
const { computeStageAverage, isStagePassed, rankApplications } = require('../services/scoringEngine');
const { uploadBuffer } = require('../config/cloudinary');
const { callClaude, getModelIds } = require('../services/claudeClient');

/** Reads a Setting's scalar value, falling back to a default if missing. */
async function getSettingValue(key, fallback) {
  const setting = await Setting.findOne({ key });
  return setting?.value ?? fallback;
}

/**
 * POST /api/requisitions
 * Creates a requisition, snapshotting the chosen pipeline template's stages
 * so later template edits never mutate an already-open requisition.
 */
const create = asyncHandler(async (req, res) => {
  const {
    title, jobDescription, pipelineTemplateId, hireThreshold, maybeThreshold,
    initialScreeningCriteria, questionnaire, applicationDeadline, aiScreeningEnabled,
  } = req.body;

  if (!title || !jobDescription || !pipelineTemplateId) {
    throw new ValidationError(['title', 'jobDescription', 'pipelineTemplateId'], 'title, jobDescription, and pipelineTemplateId are required.');
  }

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
    jobDescription,
    pipelineTemplateId,
    pipelineTemplateName,
    stages,
    hireThreshold: hireThreshold ?? defaultHire,
    maybeThreshold: maybeThreshold ?? defaultMaybe,
    initialScreeningCriteria: initialScreeningCriteria || '',
    questionnaire: Array.isArray(questionnaire) ? questionnaire : (questionnaire ? questionnaire.split('\n').filter(Boolean) : []),
    applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
    aiScreeningEnabled: aiScreeningEnabled !== undefined ? Boolean(aiScreeningEnabled) : true,
    createdBy: req.user._id,
  });

  logger.info(`[Requisition] Created "${title}" (${requisition._id}) by user=${req.user._id}`);
  res.status(201).json({ requisition });
});

/**
 * GET /api/requisitions
 * Lists requisitions, optionally filtered by status (?status=open|on_hold|closed).
 *
 * Each row carries a candidate rollup (total, still in progress, and the
 * hire/maybe/no-hire split) so the list can answer "which roles are actually
 * moving?" without the client fetching every requisition's detail separately.
 */
const list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
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
    requisitions: requisitions.map((r) => ({
      ...r,
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
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });

  const scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : null;
  const applications = await Application.find({ requisitionId: requisition._id })
    .populate('candidateId', 'name email');

  applications.sort((a, b) => {
    if (a.rank === null || a.rank === undefined) return 1;
    if (b.rank === null || b.rank === undefined) return -1;
    return a.rank - b.rank;
  });

  res.json({ requisition, scorecard, applications });
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
    title, jobDescription, status, hireThreshold, maybeThreshold, weights,
    initialScreeningCriteria, questionnaire, applicationDeadline, aiScreeningEnabled,
  } = req.body;

  if (title !== undefined) requisition.title = title;
  if (jobDescription !== undefined) requisition.jobDescription = jobDescription;
  if (hireThreshold !== undefined) requisition.hireThreshold = hireThreshold;
  if (maybeThreshold !== undefined) requisition.maybeThreshold = maybeThreshold;
  if (initialScreeningCriteria !== undefined) requisition.initialScreeningCriteria = initialScreeningCriteria;
  if (questionnaire !== undefined) {
    requisition.questionnaire = Array.isArray(questionnaire)
      ? questionnaire
      : (questionnaire ? questionnaire.split('\n').filter(Boolean) : []);
  }
  if (applicationDeadline !== undefined) requisition.applicationDeadline = applicationDeadline ? new Date(applicationDeadline) : null;
  if (aiScreeningEnabled !== undefined) requisition.aiScreeningEnabled = Boolean(aiScreeningEnabled);

  if (status !== undefined && status !== requisition.status) {
    requisition.status = status;
    if (status === 'closed') requisition.closedAt = new Date();
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
  const requisition = await Requisition.findByIdAndDelete(req.params.id);
  if (!requisition) return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition not found.' });
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

  const generated = await generateScorecard(requisition);
  generated.stages.forEach((stage) => {
    stage.attributes.forEach((attr, index) => {
      attr.attributeId = `${stage.stageKey}_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
    });
  });

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
    userPrompt = `Generate a detailed professional Job Description for the position: "${title}". ${userPromptText ? `Additional context: ${userPromptText}` : ''}`;
  } else if (fieldType === 'initialScreeningCriteria') {
    systemPrompt = 'You are an expert HR Screener defining clear, objective initial screening criteria for CV/Resume review.';
    userPrompt = `Write concise, clear initial screening criteria text for candidate CV review for the role "${title}". ${jobDescription ? `Job Description: ${jobDescription}\n` : ''}${userPromptText ? `Additional instructions: ${userPromptText}` : ''} Specify required skills, experience level, education, and key competencies.`;
  } else if (fieldType === 'questionnaire') {
    expectJson = true;
    systemPrompt = 'You are an expert HR recruiter generating relevant application questionnaire questions for job applicants.';
    userPrompt = `Generate 4 to 6 concise, relevant application questionnaire questions for candidates applying for the role "${title}". ${jobDescription ? `Job Description: ${jobDescription}\n` : ''}${userPromptText ? `Additional instructions: ${userPromptText}` : ''} Respond ONLY in JSON format: { "questions": ["Question 1", "Question 2", ...] }`;
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
    return res.json({ questions: parsed.questions || [] });
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
    .select('title jobDescription initialScreeningCriteria questionnaire applicationDeadline aiScreeningEnabled status createdAt')
    .lean();

  if (!requisition) {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" not found in database`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  if (requisition.status !== 'open') {
    logger.warn(`[Requisition] Public GET failed: Requisition "${req.params.id}" status is "${requisition.status}" (must be "open")`);
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Requisition is closed or does not exist.' });
  }

  const isExpired = requisition.applicationDeadline ? new Date() > new Date(requisition.applicationDeadline) : false;

  logger.info(`[Requisition] Public GET success: Found open requisition "${requisition.title}" (${requisition._id})`);

  res.json({
    requisition: {
      ...requisition,
      isExpired,
    },
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

  if (requisition.applicationDeadline && new Date() > new Date(requisition.applicationDeadline)) {
    return res.status(400).json({ error: 'EXPIRED', message: 'The application deadline for this position has passed.' });
  }

  const { name, email, phone, questionnaireAnswers } = req.body;
  if (!name || !email) {
    throw new ValidationError(['name', 'email'], 'Name and email are required to apply.');
  }

  let resumeFileUrl = '';
  let resumeFilePublicId = '';
  let resumeText = '';

  if (req.file) {
    const uploaded = await uploadBuffer(req.file.buffer, {
      folder: 'candidate-resumes',
      filename: `${Date.now()}-${req.file.originalname}`,
    });
    resumeFileUrl = uploaded.secureUrl;
    resumeFilePublicId = uploaded.publicId;

    try {
      const { extractArtifactText } = require('../utils/textExtractor');
      resumeText = await extractArtifactText(req.file.buffer, req.file.originalname);
    } catch (err) {
      logger.warn(`[ApplyPublic] Text extraction failed for file ${req.file.originalname}: ${err.message}`);
    }
  }

  let candidate = await Candidate.findOne({ email: email.toLowerCase().trim() });
  if (!candidate) {
    candidate = await Candidate.create({
      name,
      email: email.toLowerCase().trim(),
      phone: phone || '',
      resumeFileUrl,
      resumeFilePublicId,
    });
  } else {
    if (resumeFileUrl) {
      candidate.resumeFileUrl = resumeFileUrl;
      candidate.resumeFilePublicId = resumeFilePublicId;
    }
    if (phone) candidate.phone = phone;
    await candidate.save();
  }

  // Check if application already exists for this requisition
  let application = await Application.findOne({ candidateId: candidate._id, requisitionId: requisition._id });
  if (application) {
    return res.status(409).json({ error: 'DUPLICATE', message: 'You have already submitted an application for this position.' });
  }

  // 1. Ensure Scorecard exists for this requisition (auto-generate if missing)
  let scorecard = requisition.scorecardId ? await Scorecard.findById(requisition.scorecardId) : await Scorecard.findOne({ requisitionId: requisition._id });
  if (!scorecard) {
    try {
      const generated = await generateScorecard(requisition);
      scorecard = await Scorecard.create({ requisitionId: requisition._id, generatedByAI: true, stages: generated.stages });
      requisition.scorecardId = scorecard._id;
      await requisition.save();
      logger.info(`[ApplyPublic] Auto-generated missing scorecard for requisition ${requisition._id}`);
    } catch (scErr) {
      logger.warn(`[ApplyPublic] Could not auto-generate scorecard for requisition ${requisition._id}: ${scErr.message}`);
    }
  }

  // 2. Create Application document
  const enabledStages = (requisition.stages || []).filter((s) => s.enabled);
  const firstStage = enabledStages[0] || requisition.stages[0];
  const firstStageKey = firstStage ? firstStage.key : null;

  const stageProgress = (requisition.stages || []).map((s) => ({
    stageKey: s.key,
    status: 'pending',
    stageAverage: null,
    passed: null,
  }));

  application = await Application.create({
    candidateId: candidate._id,
    requisitionId: requisition._id,
    currentStageKey: firstStageKey,
    source: 'public_link',
    stageProgress,
  });

  // 3. Create Stage 1 Interview document
  const Interview = require('../models/Interview');
  let firstInterview = null;
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

  // 4. Initial Screening Evaluation (CV + Criteria + Questionnaire)
  let aiScore = null;
  let aiJustification = '';
  let passed = null;

  try {
    const modelIds = await getModelIds();
    const cheapModel = modelIds.cheap;

    const screeningCriteriaText = requisition.initialScreeningCriteria || 'Evaluate standard qualifications, skills, and background for the role.';
    const jobDescriptionText = requisition.jobDescription || 'Standard position description.';

    let questionnaireContext = '';
    if (requisition.aiScreeningEnabled) {
      const qAnswersText = typeof questionnaireAnswers === 'string'
        ? questionnaireAnswers
        : JSON.stringify(questionnaireAnswers || {});
      questionnaireContext = `Questionnaire Responses:\n${qAnswersText}\n\n`;
    }

    const systemPrompt = `You are an expert HR Screener evaluating a candidate's application against the Position Title, Job Description, and Initial Screening Criteria.
Evaluate how well the candidate meets the criteria on a scale of 1.0 to 5.0 (1=unqualified/no fit, 3=qualified/meets threshold, 5=exceptional fit).
Respond ONLY with a JSON object in format:
{
  "score": number (1.0 to 5.0),
  "justification": "Detailed explanation citing candidate qualifications vs initial screening criteria"
}`;

    const userPrompt = `Position: "${requisition.title}"

Job Description:
${jobDescriptionText}

Initial Screening Criteria:
${screeningCriteriaText}

Candidate Name: ${name}
${questionnaireContext}Candidate CV/Resume Text:
${resumeText || 'No plain text resume extracted.'}
`;

    const aiResult = await callClaude({
      model: cheapModel,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      expectJson: true,
    });

    const parsed = JSON.parse(aiResult.text);
    aiScore = Number(parsed.score) || 3.0;
    aiJustification = parsed.justification || 'Initial AI screening completed.';

    const passThreshold = firstStage?.passThreshold ?? 3.0;
    passed = aiScore >= passThreshold;

    application.initialScreening = {
      aiScore,
      aiJustification,
      passed,
      overridden: false,
    };

    await application.save();

  } catch (err) {
    logger.error(`[ApplyPublic] Automated AI screening error: ${err.message}`);
    await application.save();
  }

  // 5. Score Stage 1 Interview against Scorecard Rubric Attributes (if available)
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

  // 6. Auto-approve Stage 1 scores & compute pipeline results (Pass/Fail & Stage Advancement)
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

  try {
    const allApps = await Application.find({ requisitionId: requisition._id });
    const ranked = rankApplications(allApps);
    for (const app of ranked) {
      await Application.updateOne({ _id: app._id }, { rank: app.rank });
    }
  } catch (rankErr) {
    logger.warn(`[ApplyPublic] Ranking error: ${rankErr.message}`);
  }

  logger.info(`[ApplyPublic] Application submitted for candidate "${name}" (${candidate._id}) on requisition "${requisition.title}". AI Screening Enabled=${requisition.aiScreeningEnabled}, Score=${aiScore}, Passed=${passed}`);

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully! Your application is under review.',
    aiScreeningEnabled: requisition.aiScreeningEnabled,
    score: aiScore,
    passed,
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
