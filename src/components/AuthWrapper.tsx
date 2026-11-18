import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';
import Register from './Register';
import AcceptInvite from './AcceptInvite';
import PulseAnswerLink from './PulseAnswerLink';

const isAcceptInvitePath = () => window.location.pathname === '/accept-invite';
/** Personal survey link from the pulse e-mail: works signed in or not (the token covers one answer only). */
const isPulseLinkPath = () => window.location.pathname === '/pulse/answer';

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const [showRegister, setShowRegister] = useState(false);
  // /accept-invite is public (the invited person has no account yet).
  const [acceptInvite, setAcceptInvite] = useState(isAcceptInvitePath);
  const [pulseLink, setPulseLink] = useState(isPulseLinkPath);
  useEffect(() => {
    const onPop = () => { setAcceptInvite(isAcceptInvitePath()); setPulseLink(isPulseLinkPath()); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (pulseLink) return <PulseAnswerLink />;
  if (acceptInvite && !isLoading) return <AcceptInvite />;

  // Show loading state
  if (isLoading) {
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
