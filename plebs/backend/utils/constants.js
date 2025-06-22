/**
 * Application-wide constants
 */

const API_VERSION = 'v1';
const DEFAULT_PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Use env var, fallback for dev only

module.exports = {
    API_VERSION,
    DEFAULT_PORT,
    JWT_SECRET,
};