const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const logger = require('../utils/logger');
const { asyncHandler, sanitizeUser } = require('../utils/helpers');
const emailNotifier = require('../services/emailNotifier');

const TOKEN_TTL = '12h';
const RESET_TTL_MINUTES = Math.max(5, Math.min(Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30, 120));
const RESET_RESPONSE = 'If an active account uses that email address, a password-reset link has been sent.';
const RESET_REQUEST_WINDOW_MS = 15 * 60 * 1000;
const RESET_REQUEST_LIMIT = 5;
const resetRequestAttempts = new Map();

function canRequestPasswordReset(ip) {
  const now = Date.now();
  const attempts = (resetRequestAttempts.get(ip) || []).filter((timestamp) => now - timestamp < RESET_REQUEST_WINDOW_MS);
  if (attempts.length >= RESET_REQUEST_LIMIT) {
    resetRequestAttempts.set(ip, attempts);
    return false;
  }
  attempts.push(now);
  resetRequestAttempts.set(ip, attempts);
  return true;
}

/**
 * Signs a JWT for a given user id. Subject (`sub`) is the user's Mongo _id.
 * @param {string} userId
 * @returns {string}
 */
function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/**
 * POST /api/auth/login
 * Verifies email + password, returns a JWT + the sanitized user on success.
 * Body: { email, password }
 * Errors: 400 if fields missing; 401 if credentials are wrong or user inactive.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['email', 'password'], message: 'Email and password are required.' });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.active) {
    logger.warn(`[Auth] Login failed for ${email}: no such active user.`);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid email or password.' });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    logger.warn(`[Auth] Login failed for ${email}: bad password.`);
    return res.status(401).json({ error: 'AUTH_ERROR', message: 'Invalid email or password.' });
  }

  const token = signToken(user._id.toString());
  logger.info(`[Auth] Login succeeded for ${email} (role=${user.role}).`);
  return res.json({ token, user: sanitizeUser(user) });
});

/**
 * GET /api/auth/me
 * Returns the currently authenticated user (requireAuth must run first).
 */
const me = asyncHandler(async (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

/**
 * POST /api/auth/forgot-password
 * Always returns the same message to prevent account-email enumeration.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['email'], message: 'Enter your email address.' });
  if (!canRequestPasswordReset(req.ip || 'unknown')) return res.json({ message: RESET_RESPONSE });

  const user = await User.findOne({ email, active: true }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
    await user.save();

    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '');
    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const result = await emailNotifier.sendPasswordResetEmail({
      userEmail: user.email, userName: user.name, resetUrl, expiresInMinutes: RESET_TTL_MINUTES,
    });
    if (!result.sent) {
      logger.warn(`[Auth] Password-reset email could not be delivered for user=${user._id}: ${result.reason}`);
      // A safe local-only test path: never send the token back to the browser.
      // Developers can copy it from the server terminal while testing without
      // turning an arbitrary-email request into an account-takeover flaw.
      if (process.env.NODE_ENV === 'development') {
        logger.info(`[Auth] Development reset link for ${user.email}: ${resetUrl}`);
      }
    }
    else logger.info(`[Auth] Password-reset link sent for user=${user._id}.`);
  }

  return res.json({ message: RESET_RESPONSE });
});

/** POST /api/auth/reset-password — consumes one expiring password-reset token. */
const resetPassword = asyncHandler(async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['token', 'password'], message: 'Password reset link and new password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['password'], message: 'Use at least 8 characters for your new password.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
    active: true,
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', fields: ['token'], message: 'This password-reset link is invalid or has expired. Please request a new one.' });
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  // JWT `iat` is second-precision. Moving this back one second lets the new
  // login immediately after a reset work while invalidating normal older
  // sessions.
  user.passwordChangedAt = new Date(Date.now() - 1000);
  await user.save();
  logger.info(`[Auth] Password reset completed for user=${user._id}.`);
  return res.json({ message: 'Password updated. You can now sign in.' });
});

module.exports = { login, me, forgotPassword, resetPassword };
