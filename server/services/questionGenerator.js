const logger = require('../utils/logger');
const { callClaude, getModelIds } = require('./claudeClient');
const { ApiKeyError, SpendCapError } = require('../utils/errors');

/**
 * Rough signal for "use the deeper model" — senior/leadership roles get
 * CLAUDE_MODEL_DEEP (Opus). Deliberately excludes bare "executive" — titles
 * like "Sales Executive" / "Account Executive" are common individual-
 * contributor roles, not leadership, and would false-positive on it.
 */
const SENIOR_ROLE_PATTERN = /\b(senior|chief executive|chief|director|\bvp\b|vice president|head of|president|\bceo\b|\bcfo\b|\bcoo\b|\bcto\b)\b/i;

// const SYSTEM_PROMPT = `You are an expert interview designer helping an internal HR team build a structured, role-specific interview scorecard.

// For each stage provided, generate 5-8 attributes to evaluate a candidate against. Each attribute must have:
// - "name": a short label (e.g. "Quick Discovery")
// - "question": the actual question an interviewer should ask
// - "anchor5": what a score of 5 looks like — concrete, OBSERVABLE behavior (this is a Behaviorally Anchored Rating Scale anchor, not a vague trait)
// - "redFlags": what a score of 1-2 looks like — concrete, observable red-flag behavior

// Tailor every attribute to the ACTUAL role described in the job description. A "Closer" role gets discovery/objection-handling/closing attributes; an accountant role gets attention-to-detail/compliance/reconciliation attributes. Never reuse generic attributes across unrelated roles.

// Respond ONLY with valid JSON matching this exact shape. No preamble, no markdown fences, no explanation:
// {
//   "stages": [
//     { "stageKey": "hr_screen", "attributes": [
//         { "name": "...", "question": "...", "anchor5": "...", "redFlags": "..." }
//     ]}
//   ]
// }`;



const SYSTEM_PROMPT = `You are an expert interview designer helping an internal HR team build a structured, role-specific interview scorecard.

For each stage provided:
- For "resume_screen" stage ONLY: Generate EXACTLY 1 comprehensive evaluation attribute named "Overall Resume & Qualification Evaluation" assessing if the candidate's application meets the Job Description, Initial Screening Criteria, and Questionnaire requirements.
- For all other interview stages (hr_screen, technical, simulation, final, etc.): Generate 5-8 role-specific interview questions/attributes to evaluate the candidate during that interview call.

Each attribute must have:
- "name": a short label
- "question": the actual evaluation question
- "anchor5": what a score of 5 looks like — concrete, OBSERVABLE behavior or evidence
- "redFlags": what a score of 1-2 looks like — concrete red flags

Respond ONLY with valid JSON matching this exact shape. No preamble, no markdown fences, no explanation:
{
  "stages": [
    { "stageKey": "hr_screen", "attributes": [
        { "name": "...", "question": "...", "anchor5": "...", "redFlags": "..." }
    ]}
  ]
}`;

/**
 * Builds an empty scorecard skeleton (every scored stage present, no
 * attributes) so HR can author the rubric manually if AI generation fails.
 * @param {Array<{stageKey:string}>} scoredStages
 * @returns {{stages: Array<{stageKey:string, attributes: Array}>}}
 */
function buildEmptySkeleton(scoredStages) {
  return { stages: scoredStages.map((s) => ({ stageKey: s.key, attributes: [] })) };
}

/** Stages per Claude call. */
const STAGES_PER_CALL = 3;

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

/**
 * Generates a role-specific scorecard (questions + BARS attributes) from a
 * requisition's Job Description via Claude.
 */
async function generateScorecard(requisition) {
  const scoredStages = (requisition.stages || []).filter(
    (s) => s.enabled && !['status_only', 'pass_fail'].includes(s.inputType)
  );

  if (scoredStages.length === 0) {
    logger.warn('[QuestionGenerator] Requisition has no enabled scored stages; returning empty skeleton.');
    return buildEmptySkeleton(scoredStages);
  }

  const isSeniorRole = SENIOR_ROLE_PATTERN.test(requisition.title || '') || SENIOR_ROLE_PATTERN.test((requisition.jobDescription || '').slice(0, 500));
  const models = await getModelIds();
  const model = isSeniorRole ? models.deep : models.default;

  const batches = chunk(scoredStages, STAGES_PER_CALL);
  logger.info(`[QuestionGenerator] Generating scorecard for "${requisition.title}" model=${model} stages=${scoredStages.map((s) => s.key).join(',')} batches=${batches.length}`);

  const hasQuestionnaire = Array.isArray(requisition.questionnaire) && requisition.questionnaire.length > 0;
  const questionnaireBlock = hasQuestionnaire
    ? `\nApplication Questionnaire Items:\n${requisition.questionnaire.map((q) => {
        if (typeof q === 'string') return `- ${q}`;
        const idealStr = q.idealAnswer ? ` | Ideal Answer: ${q.idealAnswer}` : '';
        const redFlagStr = q.redFlags ? ` | Red Flags: ${q.redFlags}` : '';
        return `- Question: ${q.question}${idealStr}${redFlagStr}`;
      }).join('\n')}\n`
    : '';

  const hasCriteria = Boolean(requisition.initialScreeningCriteria && requisition.initialScreeningCriteria.trim());
  const criteriaBlock = hasCriteria
    ? `\nInitial Screening Criteria:\n${requisition.initialScreeningCriteria}\n`
    : '';

  const resultStages = [];
  for (const batch of batches) {
    const userPrompt = `Job Title: ${requisition.title}

Job Description:
${requisition.jobDescription}
${criteriaBlock}${questionnaireBlock}
Stages to generate attributes for:
${batch.map((s) => `- stageKey: "${s.key}" (${s.label}, inputType: ${s.inputType})`).join('\n')}`;

    try {
      // ~250 tokens per attribute (name/question/anchor5/redFlags) x up to 8
      // attributes x every stage in this batch.
      const maxTokens = Math.min(8192, Math.max(4096, batch.length * 2000));
      const { text } = await callClaude({
        model,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens,
        expectJson: true,
      });
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.stages)) {
        throw new Error('Claude response missing a "stages" array.');
      }
      resultStages.push(...parsed.stages);
    } catch (err) {
      if (err instanceof ApiKeyError || err instanceof SpendCapError) {
        throw err; // actionable, distinct conditions — let the controller surface them clearly
      }
      logger.error(`[QuestionGenerator] Batch [${batch.map((s) => s.key).join(',')}] failed, falling back to an empty skeleton for it: ${err.message}`);
      resultStages.push(...buildEmptySkeleton(batch).stages);
    }
  }

  return { stages: resultStages };
}

module.exports = { generateScorecard };