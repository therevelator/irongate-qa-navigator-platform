import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import AuthWrapper from './components/AuthWrapper'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AuthWrapper>
          <App />
        </AuthWrapper>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
