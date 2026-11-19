import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AuthWrapper from './components/AuthWrapper'
import { AnalyticsScopeProvider } from './contexts/AnalyticsScopeContext'
import OperatorPanel from './components/operator/OperatorPanel'

// /operator: IronGate platform support, with its own sign-in (platform operators are not company
// users), outside the company app and its session.
const isOperatorPath = window.location.pathname === '/operator' || window.location.pathname.startsWith('/operator/')

createRoot(document.getElementById('root')!).render(
  isOperatorPath ? (
    <StrictMode>
      <ThemeProvider>
        <OperatorPanel />
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
