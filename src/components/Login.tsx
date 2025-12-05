import React, { useState, useEffect, useRef } from 'react';
import { Shield, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Swal from 'sweetalert2';

interface LoginProps {
  onSwitchToRegister: () => void;
}

const Login: React.FC<LoginProps> = ({ onSwitchToRegister }) => {
  const { login, error: authError, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please enter both email and password',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    try {
      await login({ email, password, rememberMe });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      Swal.fire({
        icon: 'error',
        title: 'Login Failed',
        text: errorMessage,
        confirmButtonColor: '#3b82f6',
      });
      setError(errorMessage);
    }
  };

  // Particle system for logo morph
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
      targetX: number;
      targetY: number;
    }> = [];

    const logoPositions = [
      // Create a simple grid pattern that resembles the logo
      { x: canvas.width * 0.3, y: canvas.height * 0.3 },
      { x: canvas.width * 0.7, y: canvas.height * 0.3 },
      { x: canvas.width * 0.3, y: canvas.height * 0.7 },
      { x: canvas.width * 0.7, y: canvas.height * 0.7 },
      { x: canvas.width * 0.5, y: canvas.height * 0.5 },
    ];

    // Initialize particles
    for (let i = 0; i < 100; i++) {
      const targetPos = logoPositions[i % logoPositions.length];
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        size: Math.random() * 3 + 1,
        opacity: Math.random() * 0.5 + 0.2,
        targetX: targetPos.x + (Math.random() - 0.5) * 200,
        targetY: targetPos.y + (Math.random() - 0.5) * 200,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        // Move towards target with mouse influence
        const dx = particle.targetX - particle.x;
        const dy = particle.targetY - particle.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        particle.vx += dx * 0.001;
        particle.vy += dy * 0.001;
        
        // Mouse influence
        const mouseDx = mousePos.x - particle.x;
        const mouseDy = mousePos.y - particle.y;
        const mouseDistance = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy);
        
        if (mouseDistance < 100) {
          particle.vx -= mouseDx * 0.01;
          particle.vy -= mouseDy * 0.01;
        }

        // Apply friction
        particle.vx *= 0.98;
        particle.vy *= 0.98;

        particle.x += particle.vx;
        particle.y += particle.vy;

        // Draw particle
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(191, 0, 0, ${particle.opacity})`;
        ctx.fill();
      });

      requestAnimationFrame(animate);
    };

    animate();

    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [mousePos]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated particle canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 1 }}
      />

      {/* Centered glass-morphism card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8">
          <h2 className="text-3xl font-bold text-white mb-2 text-center">IronGate</h2>
          <p className="text-gray-300 mb-6 text-center">QA Navigator Platform</p>

          {/* Demo Credentials Info */}
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-4 mb-6">
            <p className="text-sm font-semibold text-gray-200 mb-2">🎯 Demo Credentials:</p>
            <div className="text-xs text-gray-300 space-y-1">
              <p>• <strong>Super Admin:</strong> admin@irongate.com</p>
              <p>• <strong>QA Manager:</strong> manager@irongate.com</p>
              <p>• <strong>Team Lead:</strong> lead@irongate.com</p>
              <p>• <strong>QA Engineer:</strong> engineer@irongate.com</p>
              <p>• <strong>Viewer:</strong> viewer@irongate.com</p>
              <p className="mt-2"><strong>Password:</strong> demo123</p>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 border border-white/20 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white/10 text-white placeholder-gray-400"
                  placeholder="you@company.com"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-12 py-3 border border-white/20 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white/10 text-white placeholder-gray-400"
                  placeholder="••••••••"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-red-600 border-white/20 rounded focus:ring-red-500 bg-white/10"
                  disabled={isLoading}
                />
                <span className="ml-2 text-sm text-gray-300">Remember me</span>
              </label>
              <button
                type="button"
                className="text-sm text-red-400 hover:text-red-300 font-medium"
              >
                Forgot password?
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white py-3 rounded-lg font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 hover:shadow-red-500/25"
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Register Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-300">
              Don't have an account?{' '}
              <button
                onClick={onSwitchToRegister}
                className="text-red-400 hover:text-red-300 font-semibold"
              >
                Create Account
              </button>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-400/70">
          <p>© {new Date().getFullYear()} IronGate Software LTD. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
