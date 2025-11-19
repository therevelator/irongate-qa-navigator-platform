import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Login from './Login';
import Register from './Register';

interface AuthWrapperProps {
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

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
