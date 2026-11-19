import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';
import Register from './Register';
import AcceptInvite from './AcceptInvite';
import PulseAnswerLink from './PulseAnswerLink';
import { ForgotPassword, ResetPassword } from './PasswordReset';
import { FORGOT_PATH, RESET_PATH } from '../lib/passwordResetPaths';

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
          <p className="text-white text-lg">Loading IronGate...</p>
        </div>
      </div>
    );
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
