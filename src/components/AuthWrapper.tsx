import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { applyTheme, SIGNED_IN_KEY } from '../lib/appearance';
import Login from './Login';
import Register from './Register';
import AcceptInvite from './AcceptInvite';
import PulseAnswerLink from './PulseAnswerLink';
import { ForgotPassword, ResetPassword } from './PasswordReset';
import { FORGOT_PATH, RESET_PATH } from '../lib/passwordResetPaths';
import { SANDBOX_VISIT_KEY } from './TryDemo';

const sandboxVisit = (): boolean => {
  try { return sessionStorage.getItem(SANDBOX_VISIT_KEY) === '1'; } catch { return false; }
};

const isAcceptInvitePath = () => window.location.pathname === '/accept-invite';
/** Personal survey link from the pulse e-mail: works signed in or not (the token covers one answer only). */
const isPulseLinkPath = () => window.location.pathname === '/pulse/answer';
/** Forgot / reset password (public): shown whether or not someone is signed in. */
const passwordPage = (): 'forgot' | 'reset' | null =>
  window.location.pathname === FORGOT_PATH ? 'forgot' : window.location.pathname === RESET_PATH ? 'reset' : null;

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { isAuthenticated, isInitializing } = useAuth();
  const { theme } = useTheme();
  // Signed-out screens (sign-in, registration, invitation, password pages) always use the classic
  // light look, whatever theme the person picked; their theme returns once they are signed in.
  // The flag lets the pre-paint script in index.html do the same before the first paint.
  useLayoutEffect(() => {
    if (isInitializing) return;
    applyTheme(document.documentElement, isAuthenticated ? theme : 'light');
    try {
      if (isAuthenticated) localStorage.setItem(SIGNED_IN_KEY, '1');
      else localStorage.removeItem(SIGNED_IN_KEY);
    } catch { /* storage unavailable */ }
  }, [isAuthenticated, isInitializing, theme]);
  const [showRegister, setShowRegister] = useState(false);
  // /accept-invite is public (the invited person has no account yet).
  const [acceptInvite, setAcceptInvite] = useState(isAcceptInvitePath);
  const [pulseLink, setPulseLink] = useState(isPulseLinkPath);
  const [password, setPassword] = useState(passwordPage);
  useEffect(() => {
    const onPop = () => { setAcceptInvite(isAcceptInvitePath()); setPulseLink(isPulseLinkPath()); setPassword(passwordPage()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (pulseLink) return <PulseAnswerLink />;
  if (password === 'reset') return <ResetPassword />;
  if (password === 'forgot') return <ForgotPassword />;
  if (acceptInvite && !isInitializing) return <AcceptInvite />;

  // Loading state while the session is first checked. Not during a sign-in or registration: the
  // form stays mounted so a wrong password or a taken e-mail is shown (and what was typed is kept).
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading QE Navigator…</p>
        </div>
      </div>
    );
  }

  // A demo sandbox session of this tab ended (two hours, or the nightly reset): back to /try.
  if (!isAuthenticated && sandboxVisit()) {
    try { sessionStorage.removeItem(SANDBOX_VISIT_KEY); } catch { /* storage unavailable */ }
    window.location.replace('/try?ended=1');
    return null;
  }

  // Show auth screens if not authenticated
  if (!isAuthenticated) {
    return showRegister ? (
      <Register onSwitchToLogin={() => setShowRegister(false)} />
    ) : (
      <Login onSwitchToRegister={() => setShowRegister(true)} />
    );
  }

  // Show main app if authenticated
  return <>{children}</>;
};

export default AuthWrapper;
