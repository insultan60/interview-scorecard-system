/**
 * Who may delete jobs and candidates (and remove a candidate from a job). The server enforces this
 * (see routes/requisitions.js and routes/candidates.js); the pages use the same rule to hide the
 * delete buttons from everyone else, so nobody clicks something that is refused.
 * @param {{ role?: string } | null | undefined} user
 * @returns {boolean}
 */
export const canDeleteRecords = (user) => user?.role === 'owner' || user?.role === 'admin';

/**
 * Who may see AI spend and the spend cap. These come from /settings, which the server only
 * gives to owners and admins, so the dashboard must not ask for them on behalf of anyone else.
 * @param {{ role?: string } | null | undefined} user
 * @returns {boolean}
 */
export const canSeeAiSpend = (user) => user?.role === 'owner' || user?.role === 'admin';

/**
 * Who may read the list of users (routes/users.js is owner/admin only). The audit log uses it for its
 * "User" filter, so everyone else does not get that filter instead of a refused request.
 * @param {{ role?: string } | null | undefined} user
 * @returns {boolean}
 */
export const canListUsers = (user) => user?.role === 'owner' || user?.role === 'admin';
