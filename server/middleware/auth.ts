import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
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
    
    next();
  } catch (error) {
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
