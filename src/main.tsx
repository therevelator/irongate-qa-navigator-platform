import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext'
import AuthWrapper from './components/AuthWrapper'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthWrapper>
        <App />
      </AuthWrapper>
    </AuthProvider>
  </StrictMode>,
)
