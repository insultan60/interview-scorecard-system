/**
 * Who may delete jobs and candidates (and remove a candidate from a job). The server enforces this
 * (see routes/requisitions.js and routes/candidates.js); the pages use the same rule to hide the
 * delete buttons from everyone else, so nobody clicks something that is refused.
 * @param {{ role?: string } | null | undefined} user
 * @returns {boolean}
 */
export const canDeleteRecords = (user) => user?.role === 'owner' || user?.role === 'admin';
