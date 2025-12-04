declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Database
      DATABASE_URL?: string;
      DB_HOST?: string;
      DB_PORT?: string;
      DB_USER?: string;
      DB_PASSWORD?: string;
      DB_NAME?: string;

      // JWT
      JWT_SECRET?: string;
      secrettoken?: string; // Legacy support

      // Server
      PORT?: string;
      NODE_ENV?: 'development' | 'production' | 'test';
      FRONTEND_URL?: string;

      // AI
      GROQ_API_KEY?: string;

      // External APIs (optional)
      JENKINS_URL?: string;
      JENKINS_TOKEN?: string;
      JIRA_URL?: string;
      JIRA_TOKEN?: string;
      SONARQUBE_URL?: string;
      SONARQUBE_TOKEN?: string;
    }
  }
}

export {};
