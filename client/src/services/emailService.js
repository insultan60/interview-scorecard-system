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

/** Sends the Calendar owner's scheduled/cancelled interview notification through EmailJS. */
export async function sendHostMeetingEmailClient({ hostEmail, action, candidateName, requisitionTitle, stageLabel, meetingUri, meetingStart, meetingEnd, timeZone = 'Asia/Karachi' }) {
  if (!isBrowserEmailJSConfigured()) {
    return { sent: false, reason: 'Client EmailJS environment variables are not configured.' };
  }
  if (!hostEmail) return { sent: false, reason: 'No Calendar host email address is configured.' };

  const isCancelled = action === 'cancelled';
  const meetingTime = meetingStart
    ? new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(meetingStart))
    : 'Not specified';
  const duration = meetingStart && meetingEnd
    ? `${Math.round((new Date(meetingEnd) - new Date(meetingStart)) / 60000)} minutes`
    : 'Not specified';
  const subject = `${isCancelled ? 'Cancelled' : 'Scheduled'}: ${candidateName || 'Candidate'} — ${stageLabel}`;
  const message = isCancelled
    ? [
      'Hello,', '', 'This is to confirm that the following interview has been cancelled.', '',
      `Candidate: ${candidateName || 'Candidate'}`,
      `Position: ${requisitionTitle || 'Interview'}`,
      `Interview stage: ${stageLabel}`,
      `Previously scheduled: ${meetingTime} (${timeZone})`, '',
      'The Google Calendar event has been removed and the candidate has been notified.', '',
      'Regards,', 'Red Star Technologies Hiring Team',
    ].join('\n')
    : [
      'Hello,', '', 'This is to confirm that an interview has been scheduled in your Google Calendar.', '',
      `Candidate: ${candidateName || 'Candidate'}`,
      `Position: ${requisitionTitle || 'Interview'}`,
      `Interview stage: ${stageLabel}`,
      `Date and time: ${meetingTime} (${timeZone})`,
      `Duration: ${duration}`,
      `Google Meet link: ${meetingUri || 'Not available'}`, '',
      'The candidate has been invited through Google Calendar. Please review the event on your calendar before the interview.', '',
      'Regards,', 'Red Star Technologies Hiring Team',
    ].join('\n');

  try {
    await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
      to_email: hostEmail, email_to: hostEmail, recipient: hostEmail,
      to_name: 'Calendar Host', candidate_name: candidateName || 'Candidate',
      requisition_title: requisitionTitle || 'Interview', stage_label: stageLabel,
      meeting_uri: meetingUri || '', subject, message, body: message,
    }, PUBLIC_KEY);
    console.log(`[EmailJS Browser] Sent host ${action} notification to ${hostEmail}.`);
    return { sent: true };
  } catch (err) {
    console.warn(`[EmailJS Browser] Failed to send host ${action} notification:`, err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send host email via browser EmailJS.' };
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

/**
 * Sends an availability request link email directly from the browser via EmailJS HTTPS API.
 */
export async function sendAvailabilityEmailClient({ candidateEmail, candidateName, requisitionTitle, stageLabel, availabilityUrl }) {
  console.log('[EmailJS Browser] Attempting to send Availability Request Email...', { candidateEmail, candidateName, requisitionTitle, stageLabel, availabilityUrl });
  if (!isBrowserEmailJSConfigured()) {
    console.warn('[EmailJS Browser] Browser EmailJS environment variables are not configured in .env.');
    return { sent: false, reason: 'Browser EmailJS is not configured.' };
  }

  if (!candidateEmail) {
    console.warn('[EmailJS Browser] Candidate email is missing.');
    return { sent: false, reason: 'No candidate email address on file.' };
  }

  const subject = `Please provide your availability — ${requisitionTitle} (${stageLabel})`;
  const message = [
    `Hi ${candidateName || 'there'},`,
    '',
    `Our hiring team would like to arrange your interview for the ${stageLabel} stage of your application for ${requisitionTitle}.`,
    '',
    'Please click the link below to select your preferred date and time windows:',
    availabilityUrl,
    '',
    'Thank you,',
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
        stage_label: stageLabel,
        availability_url: availabilityUrl,
        link: availabilityUrl,
        subject,
        message,
        body: message,
      },
      PUBLIC_KEY
    );
    console.log(`[EmailJS Browser] Successfully sent availability request email to ${candidateEmail}`);
    return { sent: true };
  } catch (err) {
    console.warn('[EmailJS Browser] Failed to send availability email:', err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send availability email via browser EmailJS.' };
  }
}

/**
 * Sends a ClickUp onboarding form email directly from the browser via EmailJS HTTPS API as a fallback.
 * @param {{candidateEmail: string, candidateName?: string, onboardingUrl?: string}} params
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function sendOnboardingFormEmailClient({ candidateEmail, candidateName, onboardingUrl }) {
  if (!isBrowserEmailJSConfigured()) {
    return { sent: false, reason: 'Client EmailJS environment variables are not configured.' };
  }

  if (!candidateEmail) {
    return { sent: false, reason: 'No candidate email address found on file.' };
  }

  const url = onboardingUrl || 'https://forms.clickup.com/9018918616/f/8ct3hpr-11198/JXG8EGK3RD18TR60TO';
  const subject = 'ON BOARDING FORM — Red Star Technologies';
  const message = [
    `Hi ${candidateName || 'there'},`,
    '',
    'ON BOARDING FORM',
    'Welcome to Red Star Technologies! We are thrilled to have you join our team. This onboarding document outlines the key information, policies, and tools you need to integrate smoothly into our work environment. We are committed to supporting your success.',
    '',
    'Please complete your onboarding form using the link below:',
    url,
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
        onboarding_url: url,
        link: url,
        subject,
        message,
        body: message,
      },
      PUBLIC_KEY
    );
    console.log(`[EmailJS Browser] Successfully sent onboarding form email to ${candidateEmail} via EmailJS Browser API.`);
    return { sent: true };
  } catch (err) {
    console.warn('[EmailJS Browser] Failed to send onboarding form email from client:', err);
    return { sent: false, reason: err?.text || err?.message || 'Failed to send email via browser EmailJS.' };
  }
}
