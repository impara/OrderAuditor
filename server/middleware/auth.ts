import { Request, Response, NextFunction } from "express";

declare module 'express-session' {
  interface SessionData {
    userId: string;
    isAuthenticated: boolean;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  
  res.status(401).json({ error: "Authentication required" });
}

export function isAuthenticated(req: Request): boolean {
  return !!(req.session && req.session.isAuthenticated);
}
