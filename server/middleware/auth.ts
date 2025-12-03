import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const secrettoken = process.env.secrettoken || 'your-secret-key-change-in-production';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    companyId: string;
    primaryTeamId?: string;
    departmentId?: string;
  };
  userId?: string;
  userRole?: string;
  companyId?: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  // Debug: Log incoming cookies
  console.log('[Auth] Cookies received:', Object.keys(req.cookies || {}));
  console.log('[Auth] Cookie irongate_token exists:', !!req.cookies?.irongate_token);
  
  // Check cookie first, then header
  let token = req.cookies?.irongate_token;

  if (!token) {
    const authHeader = req.headers['authorization'];
    console.log('[Auth] No cookie, checking header. Auth header:', authHeader ? 'present' : 'missing');
    token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  }

  if (!token) {
    console.log('[Auth] No token found in cookies or Authorization header');
    return res.status(401).json({ error: 'Access token required' });
  }

  console.log('[Auth] Token found, length:', token.length, 'starts with:', token.substring(0, 20) + '...');

  try {
    const decoded = jwt.verify(token, secrettoken) as any;
    
    // Set user object for new routes
    req.user = {
      id: decoded.userId,
      role: decoded.role,
      companyId: decoded.companyId,
      primaryTeamId: decoded.primaryTeamId,
      departmentId: decoded.departmentId
    };
    
    // Keep backward compatibility
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    req.companyId = decoded.companyId;
    
    console.log(`[Auth] User authenticated: ${decoded.userId} (${decoded.role})`);
    next();
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
