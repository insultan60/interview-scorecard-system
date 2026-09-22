import emailjs from '@emailjs/browser';

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

/**
 * Checks if browser-side EmailJS credentials are configured in Vite environment variables.
 */
export function isBrowserEmailJSConfigured() {
  return Boolean(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY);
}

/**
 * Sends a meeting link email directly from the browser via EmailJS HTTPS API.
 * @param {{candidateEmail: string, candidateName?: string, requisitionTitle: string, stageLabel: string, meetingUri: string}} params
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendMeetingEmailClient({ candidateEmail, candidateName, requisitionTitle, stageLabel, meetingUri }) {
  if (!isBrowserEmailJSConfigured()) {
    return { sent: false, reason: 'Client EmailJS environment variables are not configured.' };
  }

  if (!candidateEmail) {
    return { sent: false, reason: 'No candidate email address found on file.' };
  }

  const subject = `Your interview link — ${requisitionTitle} (${stageLabel})`;
  const message = [
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

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      {
        to_email: candidateEmail,
        email_to: candidateEmail,
        recipient: candidateEmail,
        to_name: candidateName || 'Candidate',
        candidate_name: candidateName || 'Candidate',
        requisition_title: requisitionTitle,
        stage_label: stageLabel,
        meeting_uri: meetingUri,
        subject,
        message,
        body: message,
      },
      PUBLIC_KEY
    );
    console.log(`[EmailJS Browser] Successfully sent meeting link email to ${candidateEmail} via EmailJS Browser API.`);
    return { sent: true };
  } catch (err) {
    console.warn('[EmailJS Browser] Failed to send email from client:', err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send email via browser EmailJS.' };
  }
}

/**
 * Sends a job offer letter email directly from the browser via EmailJS HTTPS API.
 * @param {{candidateEmail: string, candidateName?: string, requisitionTitle: string, offerLetterUrl?: string}} params
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendOfferEmailClient({ candidateEmail, candidateName, requisitionTitle, offerLetterUrl }) {
  if (!isBrowserEmailJSConfigured()) {
    return { sent: false, reason: 'Client EmailJS environment variables are not configured.' };
  }

  if (!candidateEmail) {
    return { sent: false, reason: 'No candidate email address found on file.' };
  }

  const subject = `Job Offer — ${requisitionTitle}`;
  const message = [
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

  console.log('[EmailJS Browser] Preparing offer email payload:', {
    candidateEmail,
    candidateName,
    requisitionTitle,
    offerLetterUrl,
  });

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      {
        to_email: candidateEmail,
        email_to: candidateEmail,
        recipient: candidateEmail,
        to_name: candidateName || 'Candidate',
        candidate_name: candidateName || 'Candidate',
        requisition_title: requisitionTitle,
        offer_url: offerLetterUrl || '',
        offer_link: offerLetterUrl || '',
        offer_letter_url: offerLetterUrl || '',
        artifact_file_url: offerLetterUrl || '',
        meeting_uri: offerLetterUrl || '',
        link: offerLetterUrl || '',
        subject,
        message,
        body: message,
      },
      PUBLIC_KEY
    );
    console.log(`[EmailJS Browser] Successfully sent offer letter email to ${candidateEmail} via EmailJS Browser API.`);
    return { sent: true };
  } catch (err) {
    console.warn('[EmailJS Browser] Failed to send offer email from client:', err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send offer email via browser EmailJS.' };
  }
}

/** Sends an application-received confirmation directly through EmailJS. */
export async function sendApplicationConfirmationEmailClient({ candidateEmail, candidateName, requisitionTitle }) {
  if (!isBrowserEmailJSConfigured()) {
    return { sent: false, reason: 'Client EmailJS environment variables are not configured.' };
  }
  if (!candidateEmail) {
    return { sent: false, reason: 'No candidate email address found.' };
  }

  const subject = `Application received — ${requisitionTitle}`;
  const message = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Thank you for applying for the ${requisitionTitle} position at Red Star Technologies.`,
    '',
    'We have received your application and our hiring team will review it.',
    '',
    'Best regards,',
    'Red Star Technologies Hiring Team',
  ].join('\n');

  try {
    await emailjs.send(
      SERVICE_ID,
      TEMPLATE_ID,
      {
        to_email: candidateEmail,
        email_to: candidateEmail,
        recipient: candidateEmail,
        to_name: candidateName || 'Candidate',
        candidate_name: candidateName || 'Candidate',
        requisition_title: requisitionTitle,
        subject,
        message,
        body: message,
      },
      PUBLIC_KEY
    );
    return { sent: true };
  } catch (err) {
    console.warn('[EmailJS Browser] Failed to send application confirmation:', err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send application confirmation email.' };
  }
}
