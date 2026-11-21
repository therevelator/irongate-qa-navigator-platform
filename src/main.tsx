import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AuthWrapper from './components/AuthWrapper'
import { AnalyticsScopeProvider } from './contexts/AnalyticsScopeContext'
import OperatorPanel from './components/operator/OperatorPanel'
import TryDemo from './components/TryDemo'

// /operator: IronGate platform support, with its own sign-in (platform operators are not company
// users), outside the company app and its session.
const isOperatorPath = window.location.pathname === '/operator' || window.location.pathname.startsWith('/operator/')
// /try: the self-serve demo (public; signs the visitor in as a persona of the demo sandbox).
const isTryPath = window.location.pathname === '/try' || window.location.pathname === '/try/'

createRoot(document.getElementById('root')!).render(
  isOperatorPath ? (
    <StrictMode>
      <ThemeProvider>
        <OperatorPanel />
      </ThemeProvider>
    </StrictMode>
  ) : isTryPath ? (
    <StrictMode>
      <ThemeProvider>
        <TryDemo />
      </ThemeProvider>
    </StrictMode>
  ) : (
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AuthWrapper>
          <AnalyticsScopeProvider>
            <App />
          </AnalyticsScopeProvider>
        </AuthWrapper>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
  ),
)
