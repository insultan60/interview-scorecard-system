const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const { getSecrets } = require('../utils/secrets');

let cachedTransporter = null;
let cachedForUser = null;
let cachedForPassword = null;

/**
 * Builds (and caches) a Nodemailer transporter authenticated against Gmail
 * via an App Password. Re-built whenever either credential changes (e.g. an
 * admin edits Settings, or the App Password is rotated), so a stale
 * transporter never keeps authenticating with a revoked secret.
 *
 * Timeouts are explicit: nodemailer's ~2-minute defaults would let a blocked
 * outbound SMTP port hang the HTTP request that triggered the send until a
 * platform proxy kills it — for a meeting that was already saved.
 * @returns {Promise<import('nodemailer').Transporter|null>} null if not configured.
 */
async function getTransporter() {
  const { gmailUser, gmailAppPassword } = await getSecrets();
  if (!gmailUser || !gmailAppPassword) return null;

  if (cachedTransporter && cachedForUser === gmailUser && cachedForPassword === gmailAppPassword) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailAppPassword },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  cachedForUser = gmailUser;
  cachedForPassword = gmailAppPassword;
  return cachedTransporter;
}

/**
 * Sends an email. Never throws — a missing configuration or a send failure
 * is logged as a warning and reported back via the return value, so a
 * candidate-facing email can never take down the request that triggered it
 * (same philosophy as slackNotifier.js).
 * @param {{to:string, subject:string, text:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendEmail({ to, subject, text }) {
  if (!to) return { sent: false, reason: 'No recipient email on file.' };

  const transporter = await getTransporter();
  if (!transporter) {
    logger.warn('[EmailNotifier] Gmail not configured (GMAIL_USER/GMAIL_APP_PASSWORD) — skipping email.');
    return { sent: false, reason: 'Email sending is not configured yet.' };
  }

  const { gmailUser } = await getSecrets();
  try {
    await transporter.sendMail({ from: `"Red Star Technologies" <${gmailUser}>`, to, subject, text });
    logger.info(`[EmailNotifier] Sent "${subject}" to ${to}.`);
    return { sent: true };
  } catch (err) {
    logger.warn(`[EmailNotifier] Failed to send to ${to}: ${err.message}`);
    return { sent: false, reason: 'Failed to send — check Gmail credentials in Settings.' };
  }
}

/**
 * Emails a candidate their interview meeting link.
 * @param {{candidateEmail:string, candidateName:string, requisitionTitle:string, stageLabel:string, meetingUri:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendMeetingLinkEmail({ candidateEmail, candidateName, requisitionTitle, stageLabel, meetingUri }) {
  const subject = `Your interview link — ${requisitionTitle} (${stageLabel})`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Here is your meeting link for the ${stageLabel} stage of your ${requisitionTitle} interview:`,
    '',
    meetingUri,
    '',
    'Please join a few minutes early to make sure your camera/microphone are working.',
    '',
    'Best,',
    'Red Star Technologies',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/**
 * Emails a candidate their formal job offer letter announcement & document link.
 * @param {{candidateEmail:string, candidateName:string, requisitionTitle:string, offerLetterUrl?:string}} params
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
async function sendOfferEmail({ candidateEmail, candidateName, requisitionTitle, offerLetterUrl }) {
  const subject = `Job Offer — ${requisitionTitle}`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Congratulations! We are delighted to extend a formal job offer for the ${requisitionTitle} position at Red Star Technologies.`,
    '',
    offerLetterUrl ? `You can view and download your official Offer Letter here:\n${offerLetterUrl}` : '',
    '',
    'Please review the details and let us know if you have any questions.',
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].filter(Boolean).join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/** Sends a confirmation after a candidate submits a public job application. */
async function sendApplicationConfirmationEmail({ candidateEmail, candidateName, requisitionTitle }) {
  const subject = `Application received — ${requisitionTitle}`;
  const text = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Thank you for applying for the ${requisitionTitle} position at Red Star Technologies.`,
    '',
    'We have received your application and our hiring team will review it.',
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].join('\n');

  return sendEmail({ to: candidateEmail, subject, text });
}

/** Sends an internal user a one-time link for changing their password. */
async function sendPasswordResetEmail({ userEmail, userName, resetUrl, expiresInMinutes }) {
  const subject = 'Reset your Interview Scorecard password';
  const text = [
    `Hi ${userName || 'there'},`,
    '',
    'We received a request to reset your Interview Scorecard password.',
    '',
    `Choose a new password here (this link expires in ${expiresInMinutes} minutes):`,
    resetUrl,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    'Red Star Technologies',
  ].join('\n');

  return sendEmail({ to: userEmail, subject, text });
}

module.exports = { sendEmail, sendMeetingLinkEmail, sendOfferEmail, sendApplicationConfirmationEmail, sendPasswordResetEmail };
