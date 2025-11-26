/**
 * API Configuration
 * Automatically uses the correct API URL based on environment
 */

// In production (Netlify), use relative path which gets redirected to functions
// In development, use localhost backend server
export const API_URL = 
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api'
    : '/api';

// Export for easy importing
export default API_URL;
