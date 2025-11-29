import React, { useState } from 'react';
import { Shield, Mail, Lock, Eye, EyeOff, User, CheckCircle, Building2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types/auth';
import Swal from 'sweetalert2';
// Department and team will be created during registration

interface RegisterProps {
  onSwitchToLogin: () => void;
}

const Register: React.FC<RegisterProps> = ({ onSwitchToLogin }) => {
  const { register, error: authError, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'super_admin' as UserRole,
    companyName: '',
    departmentName: '',
    teamName: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(0);

  const validatePassword = (password: string): number => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;
    return strength;
  };

  // Validate name: letters (including accented), spaces, hyphens, apostrophes only - no numbers or special chars
  const validateName = (name: string): boolean => {
    // Allow Unicode letters, spaces, hyphens, and apostrophes
    const nameRegex = /^[\p{L}\s'-]+$/u;
    return nameRegex.test(name) && !/\d/.test(name);
  };

  // Validate company name: letters, numbers, spaces, hyphens, apostrophes, ampersand, periods
  const validateCompanyName = (name: string): boolean => {
    const companyRegex = /^[\p{L}\d\s'&.-]+$/u;
    return companyRegex.test(name);
  };

  const handlePasswordChange = (password: string) => {
    setFormData({ ...formData, password });
    setPasswordStrength(validatePassword(password));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation - Required fields
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password || !formData.companyName) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please fill in all required fields',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Validate first name
    if (!validateName(formData.firstName)) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid First Name',
        text: 'First name can only contain letters, spaces, hyphens, and apostrophes. No numbers or special characters allowed.',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Validate last name
    if (!validateName(formData.lastName)) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid Last Name',
        text: 'Last name can only contain letters, spaces, hyphens, and apostrophes. No numbers or special characters allowed.',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    // Validate company name
    if (!validateCompanyName(formData.companyName)) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid Company Name',
        text: 'Company name can only contain letters, numbers, spaces, hyphens, apostrophes, ampersands, and periods.',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    if (!formData.departmentName || !formData.teamName) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please enter your department and team names',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      Swal.fire({
        icon: 'error',
        title: 'Password Mismatch',
        text: 'Passwords do not match',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    if (passwordStrength < 3) {
      Swal.fire({
        icon: 'warning',
        title: 'Weak Password',
        text: 'Password is too weak. Please use a stronger password with uppercase, numbers, and special characters.',
        confirmButtonColor: '#3b82f6',
      });
      return;
    }

    try {
      await register({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        companyName: formData.companyName,
        departmentName: formData.departmentName,
        teamName: formData.teamName,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
      Swal.fire({
        icon: 'error',
        title: 'Registration Failed',
        text: errorMessage,
        confirmButtonColor: '#3b82f6',
      });
      setError(errorMessage);
    }
  };

  const getPasswordStrengthColor = () => {
    if (passwordStrength <= 2) return 'bg-red-500';
    if (passwordStrength === 3) return 'bg-yellow-500';
    if (passwordStrength === 4) return 'bg-green-500';
    return 'bg-green-600';
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength <= 2) return 'Weak';
    if (passwordStrength === 3) return 'Fair';
    if (passwordStrength === 4) return 'Good';
    return 'Strong';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <img 
              src="/irongate-logo.png" 
              alt="IronGate" 
              className="w-20 h-20 rounded-xl" 
              onError={(e) => { 
                e.currentTarget.style.display = 'none';
                e.currentTarget.nextElementSibling?.classList.remove('hidden');
              }} 
            />
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center hidden">
              <Shield className="text-white" size={40} />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">IronGate</h1>
          <p className="text-gray-600 dark:text-gray-400">QA Navigator Platform</p>
        </div>

        {/* Register Card */}
        <div className="bg-gray-100 dark:bg-slate-800 rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300 mb-2">Create Account</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">Join IronGate QA Navigator today</p>

          {/* Register Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  First Name *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    id="firstName"
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                    placeholder="John"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Last Name *
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="Doe"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address *
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="you@company.com"
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Company */}
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Company Name *
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="company"
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="Your company name"
                  disabled={isLoading}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Enter your company name. A unique company ID will be created for data isolation.
              </p>
            </div>

            {/* Department Name */}
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Department / Program Name *
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="department"
                  type="text"
                  value={formData.departmentName}
                  onChange={(e) => setFormData({ ...formData, departmentName: e.target.value })}
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="e.g., Engineering, QA, Product"
                  disabled={isLoading}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your first department. More can be added from the Admin Panel after registration.
              </p>
            </div>

            {/* Team Name */}
            <div>
              <label htmlFor="team" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Team Name *
              </label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="team"
                  type="text"
                  value={formData.teamName}
                  onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="e.g., Alpha Team, Platform Squad"
                  disabled={isLoading}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Your first team. More teams can be added from the Admin Panel after registration.
              </p>
            </div>

            {/* Role Display (Locked to Super Admin) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Account Role
              </label>
              <div className="w-full px-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-gray-700 dark:text-gray-300 flex items-center">
                <span className="mr-2">👑</span>
                <span className="font-medium">Super Admin</span>
                <span className="ml-2 text-gray-500 dark:text-gray-400">- Full system control</span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                As the first user, you will be the Super Admin. Additional users with different roles can be created from the Admin Panel after registration.
              </p>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  className="w-full pl-11 pr-12 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="••••••••"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-400"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              
              {/* Password Strength Indicator */}
              {formData.password && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400">Password Strength:</span>
                    <span className={`text-xs font-semibold ${
                      passwordStrength <= 2 ? 'text-red-600' :
                      passwordStrength === 3 ? 'text-yellow-600' :
                      'text-green-600'
                    }`}>
                      {getPasswordStrengthText()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${getPasswordStrengthColor()}`}
                      style={{ width: `${(passwordStrength / 5) * 100}%` }}
                    />
                  </div>
                  <div className="mt-2 space-y-1">
                    <PasswordRequirement met={formData.password.length >= 8} text="At least 8 characters" />
                    <PasswordRequirement met={/[A-Z]/.test(formData.password)} text="One uppercase letter" />
                    <PasswordRequirement met={/[0-9]/.test(formData.password)} text="One number" />
                    <PasswordRequirement met={/[^a-zA-Z0-9]/.test(formData.password)} text="One special character" />
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Confirm Password *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="w-full pl-11 pr-4 py-3 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300"
                  placeholder="••••••••"
                  disabled={isLoading}
                />
              </div>
              {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">Passwords do not match</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full text-white py-3 rounded-lg font-semibold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#bf0000' }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating Account...
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Already have an account?{' '}
              <button
                onClick={onSwitchToLogin}
                className="text-blue-600 hover:text-blue-800 font-semibold"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-blue-200">
          <p>© {new Date().getFullYear()} IronGate Software LTD. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

// Helper component for password requirements
const PasswordRequirement: React.FC<{ met: boolean; text: string }> = ({ met, text }) => (
  <div className="flex items-center text-xs">
    {met ? (
      <CheckCircle className="text-green-600 mr-2" size={14} />
    ) : (
      <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 mr-2" />
    )}
    <span className={met ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'}>{text}</span>
  </div>
);

export default Register;
