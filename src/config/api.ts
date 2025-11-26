/**
 * API Configuration
 * Automatically uses the correct API URL based on environment
 */

// In production (Netlify), use relative path which gets redirected to functions
// In development, use localhost backend server
export const API_URL = import.meta.env.VITE_API_URL || 
  (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3000/api');

// Export for easy importing
export default API_URL;
