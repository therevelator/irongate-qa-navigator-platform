/** Public pages of the forgot / reset password flow (src/components/PasswordReset.tsx). */
export const FORGOT_PATH = '/forgot-password';
export const RESET_PATH = '/reset-password';

/** Client-side navigation between the public pages (AuthWrapper listens to popstate). */
export const goTo = (path: string) => {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
