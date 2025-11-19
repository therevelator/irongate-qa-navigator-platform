# 🗄️ IronGate QA Navigator - Database Schema

## Overview

This document provides the complete database schema for IronGate QA Navigator, including all tables, relationships, indexes, and sample data.

**Database Type**: PostgreSQL (recommended) or MySQL  
**ORM Compatible**: Yes (Prisma, TypeORM, Sequelize)  
**Version**: 1.0

---

## Database Architecture

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    Users    │──────▶│  UserTeams  │◀──────│    Teams    │
└─────────────┘       └─────────────┘       └─────────────┘
       │                                            │
       │                                            │
       ▼                                            ▼
┌─────────────┐                            ┌─────────────┐
│   Sessions  │                            │   Metrics   │
└─────────────┘                            └─────────────┘
                                                   │
       ┌───────────────────────────────────────────┤
       │                                           │
       ▼                                           ▼
┌─────────────┐                            ┌─────────────┐
│  TestCases  │                            │    Builds   │
└─────────────┘                            └─────────────┘
       │                                           │
       │                                           │
       ▼                                           ▼
┌─────────────┐                            ┌─────────────┐
│TestExecutions│                           │  Pipelines  │
└─────────────┘                            └─────────────┘
```

---

## Complete SQL Schema

### PostgreSQL Version

```sql
-- ============================================================================
-- IRONGATE QA NAVIGATOR - DATABASE SCHEMA
-- Version: 1.0
-- Database: PostgreSQL 14+
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. USERS & AUTHENTICATION
-- ============================================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer')),
    avatar_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    refresh_token VARCHAR(500),
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit log table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. TEAMS & ORGANIZATION
-- ============================================================================

-- Teams table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    department VARCHAR(100) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- User-Team relationship (many-to-many)
CREATE TABLE user_teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member' CHECK (role IN ('owner', 'lead', 'member')),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, team_id)
);

-- ============================================================================
-- 3. METRICS & KPIs
-- ============================================================================

-- Team metrics (daily snapshots)
CREATE TABLE team_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    
    -- Quality & Testing
    qa_score DECIMAL(5,2),
    test_coverage DECIMAL(5,2),
    flakiness_rate DECIMAL(5,2),
    defect_density DECIMAL(5,2),
    defect_escape_rate DECIMAL(5,2),
    code_quality_score DECIMAL(5,2),
    
    -- Speed & Efficiency
    build_time INTEGER, -- seconds
    test_execution_time INTEGER, -- seconds
    deployment_frequency INTEGER,
    lead_time_for_changes INTEGER, -- hours
    mttr DECIMAL(5,2), -- hours
    parallel_test_efficiency DECIMAL(5,2),
    
    -- Agile & Process
    sprint_velocity INTEGER,
    sprint_commitment_rate DECIMAL(5,2),
    sprint_carryover INTEGER,
    first_time_pass_rate DECIMAL(5,2),
    blocked_time DECIMAL(5,2), -- hours
    test_automation_coverage DECIMAL(5,2),
    automation_roi DECIMAL(10,2),
    
    -- Reliability & Stability
    change_failure_rate DECIMAL(5,2),
    mtbf DECIMAL(10,2), -- hours
    system_availability DECIMAL(5,2),
    infrastructure_failures INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, metric_date)
);

-- Metric history (for trending)
CREATE TABLE metric_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(10,2) NOT NULL,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_metric_history_team_metric (team_id, metric_name, recorded_at)
);

-- ============================================================================
-- 4. TEST MANAGEMENT
-- ============================================================================

-- Test cases
CREATE TABLE test_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    type VARCHAR(50) CHECK (type IN ('automated', 'manual', 'exploratory')),
    priority VARCHAR(50) CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'archived')),
    automation_type VARCHAR(100),
    preconditions TEXT,
    steps TEXT,
    expected_result TEXT,
    requirements TEXT[], -- Array of requirement IDs
    tags TEXT[],
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Test executions
CREATE TABLE test_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    executed_by UUID REFERENCES users(id),
    status VARCHAR(50) NOT NULL CHECK (status IN ('passed', 'failed', 'blocked', 'skipped', 'running')),
    duration INTEGER, -- seconds
    error_message TEXT,
    stack_trace TEXT,
    screenshots TEXT[],
    logs TEXT,
    environment VARCHAR(100),
    build_number VARCHAR(100),
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Flaky tests tracking
CREATE TABLE flaky_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_case_id UUID NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    flakiness_score DECIMAL(5,2) NOT NULL,
    total_runs INTEGER NOT NULL,
    failed_runs INTEGER NOT NULL,
    pattern VARCHAR(100), -- 'intermittent', 'time-dependent', 'environment', 'data-dependent'
    last_failure_at TIMESTAMP,
    suggested_fix TEXT,
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'fixed', 'ignored')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. CI/CD & BUILDS
-- ============================================================================

-- Builds
CREATE TABLE builds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    build_number VARCHAR(100) NOT NULL,
    branch VARCHAR(200),
    commit_sha VARCHAR(100),
    status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failure', 'running', 'cancelled', 'unstable')),
    duration INTEGER, -- seconds
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    triggered_by UUID REFERENCES users(id),
    jenkins_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, build_number)
);

-- Pipeline stages
CREATE TABLE pipeline_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    build_id UUID NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    stage_name VARCHAR(200) NOT NULL,
    stage_order INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failure', 'running', 'skipped')),
    duration INTEGER, -- seconds
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    logs TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deployments
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    build_id UUID REFERENCES builds(id),
    environment VARCHAR(100) NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    version VARCHAR(100),
    status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failure', 'running', 'rolled_back')),
    deployed_by UUID REFERENCES users(id),
    deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rollback_at TIMESTAMP,
    notes TEXT
);

-- ============================================================================
-- 6. TECHNICAL DEBT
-- ============================================================================

-- Technical debt items
CREATE TABLE technical_debt (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL CHECK (category IN ('code_quality', 'architecture', 'testing', 'documentation', 'security')),
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    effort_hours DECIMAL(10,2),
    cost_of_delay DECIMAL(15,2),
    priority_score DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'wont_fix')),
    source VARCHAR(100), -- 'sonarqube', 'manual', 'code_review'
    source_id VARCHAR(200),
    assigned_to UUID REFERENCES users(id),
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. PERFORMANCE METRICS
-- ============================================================================

-- Performance test results
CREATE TABLE performance_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    test_name VARCHAR(200) NOT NULL,
    endpoint VARCHAR(500),
    method VARCHAR(10),
    concurrent_users INTEGER,
    duration INTEGER, -- seconds
    
    -- Response times (milliseconds)
    response_time_p50 DECIMAL(10,2),
    response_time_p95 DECIMAL(10,2),
    response_time_p99 DECIMAL(10,2),
    response_time_avg DECIMAL(10,2),
    response_time_max DECIMAL(10,2),
    
    -- Throughput
    requests_per_second DECIMAL(10,2),
    total_requests INTEGER,
    successful_requests INTEGER,
    failed_requests INTEGER,
    error_rate DECIMAL(5,2),
    
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. BUSINESS IMPACT
-- ============================================================================

-- Business metrics correlation
CREATE TABLE business_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    
    -- Business KPIs
    revenue DECIMAL(15,2),
    customer_satisfaction DECIMAL(5,2),
    feature_adoption_rate DECIMAL(5,2),
    user_engagement_score DECIMAL(5,2),
    churn_rate DECIMAL(5,2),
    
    -- Incidents
    production_incidents INTEGER,
    customer_reported_bugs INTEGER,
    sla_breaches INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, metric_date)
);

-- ============================================================================
-- 9. GAMIFICATION
-- ============================================================================

-- Team achievements
CREATE TABLE achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    category VARCHAR(100),
    points INTEGER DEFAULT 0,
    criteria JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Team achievement awards
CREATE TABLE team_achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    evidence JSONB,
    UNIQUE(team_id, achievement_id)
);

-- Team points history
CREATE TABLE team_points (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    points INTEGER NOT NULL,
    reason VARCHAR(500),
    category VARCHAR(100),
    awarded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 10. NOTIFICATIONS & ALERTS
-- ============================================================================

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) CHECK (type IN ('info', 'warning', 'error', 'success')),
    category VARCHAR(100),
    link VARCHAR(500),
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Alert rules
CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    condition VARCHAR(50) NOT NULL CHECK (condition IN ('greater_than', 'less_than', 'equals', 'not_equals')),
    threshold DECIMAL(10,2) NOT NULL,
    severity VARCHAR(50) CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    notify_users UUID[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Users indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;

-- Sessions indexes
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Teams indexes
CREATE INDEX idx_teams_department ON teams(department);
CREATE INDEX idx_teams_status ON teams(status);

-- User-Teams indexes
CREATE INDEX idx_user_teams_user ON user_teams(user_id);
CREATE INDEX idx_user_teams_team ON user_teams(team_id);

-- Metrics indexes
CREATE INDEX idx_team_metrics_team_date ON team_metrics(team_id, metric_date DESC);
CREATE INDEX idx_metric_history_lookup ON metric_history(team_id, metric_name, recorded_at DESC);

-- Test cases indexes
CREATE INDEX idx_test_cases_team ON test_cases(team_id);
CREATE INDEX idx_test_cases_type ON test_cases(type);
CREATE INDEX idx_test_cases_status ON test_cases(status);

-- Test executions indexes
CREATE INDEX idx_test_executions_case ON test_executions(test_case_id);
CREATE INDEX idx_test_executions_team ON test_executions(team_id);
CREATE INDEX idx_test_executions_status ON test_executions(status);
CREATE INDEX idx_test_executions_date ON test_executions(executed_at DESC);

-- Builds indexes
CREATE INDEX idx_builds_team ON builds(team_id);
CREATE INDEX idx_builds_status ON builds(status);
CREATE INDEX idx_builds_date ON builds(created_at DESC);

-- Technical debt indexes
CREATE INDEX idx_tech_debt_team ON technical_debt(team_id);
CREATE INDEX idx_tech_debt_status ON technical_debt(status);
CREATE INDEX idx_tech_debt_priority ON technical_debt(priority_score DESC);

-- Notifications indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_test_cases_updated_at BEFORE UPDATE ON test_cases
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_technical_debt_updated_at BEFORE UPDATE ON technical_debt
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_flaky_tests_updated_at BEFORE UPDATE ON flaky_tests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Team summary view
CREATE VIEW v_team_summary AS
SELECT 
    t.id,
    t.name,
    t.department,
    t.status,
    COUNT(DISTINCT ut.user_id) as member_count,
    tm.qa_score,
    tm.test_coverage,
    tm.defect_escape_rate,
    tm.metric_date as last_metric_date
FROM teams t
LEFT JOIN user_teams ut ON t.id = ut.team_id
LEFT JOIN LATERAL (
    SELECT * FROM team_metrics 
    WHERE team_id = t.id 
    ORDER BY metric_date DESC 
    LIMIT 1
) tm ON true
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.name, t.department, t.status, tm.qa_score, tm.test_coverage, tm.defect_escape_rate, tm.metric_date;

-- User dashboard view
CREATE VIEW v_user_dashboard AS
SELECT 
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    u.role,
    ARRAY_AGG(DISTINCT t.id) as team_ids,
    ARRAY_AGG(DISTINCT t.name) as team_names,
    COUNT(DISTINCT n.id) FILTER (WHERE n.read_at IS NULL) as unread_notifications
FROM users u
LEFT JOIN user_teams ut ON u.id = ut.user_id
LEFT JOIN teams t ON ut.team_id = t.id
LEFT JOIN notifications n ON u.id = n.user_id
WHERE u.deleted_at IS NULL AND u.is_active = true
GROUP BY u.id, u.email, u.first_name, u.last_name, u.role;

-- Flaky test summary view
CREATE VIEW v_flaky_test_summary AS
SELECT 
    ft.id,
    ft.team_id,
    t.name as team_name,
    tc.title as test_name,
    ft.flakiness_score,
    ft.total_runs,
    ft.failed_runs,
    ft.pattern,
    ft.status,
    ft.last_failure_at
FROM flaky_tests ft
JOIN test_cases tc ON ft.test_case_id = tc.id
JOIN teams t ON ft.team_id = t.id
WHERE ft.status != 'fixed'
ORDER BY ft.flakiness_score DESC;

-- ============================================================================
-- SAMPLE DATA (Optional - for development/demo)
-- ============================================================================

-- Insert sample achievements
INSERT INTO achievements (code, name, description, icon, category, points, criteria) VALUES
('quality-champion', 'Quality Champion', 'Maintained 95%+ test coverage for 3 sprints', '🏆', 'quality', 500, '{"metric": "test_coverage", "threshold": 95, "duration_sprints": 3}'),
('speed-demon', 'Speed Demon', 'Fastest pipeline execution time', '⚡', 'speed', 300, '{"metric": "pipeline_duration", "rank": 1}'),
('bug-hunter', 'Bug Hunter', 'Found and fixed 50+ bugs', '🎯', 'quality', 400, '{"metric": "bugs_fixed", "threshold": 50}'),
('zero-defects', 'Zero Defects', 'Zero production bugs in sprint', '💎', 'quality', 1000, '{"metric": "production_bugs", "threshold": 0}'),
('automation-master', 'Automation Master', '90%+ test automation coverage', '🤖', 'automation', 600, '{"metric": "automation_coverage", "threshold": 90}');

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
```

---

## MySQL Version

For MySQL compatibility, use this version:

```sql
-- MySQL 8.0+ Version
-- Replace UUID with CHAR(36) and uuid_generate_v4() with UUID()
-- Replace JSONB with JSON
-- Replace TEXT[] with JSON
-- Remove CHECK constraints (use application-level validation)
-- Adjust timestamp defaults

-- Example conversion:
CREATE TABLE users (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) UNIQUE NOT NULL,
    -- ... rest of fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## Next Steps

1. **Create Database**: Run the SQL script
2. **Set up Migrations**: Use Prisma or TypeORM
3. **Seed Data**: Add initial users and teams
4. **Configure ORM**: Connect to database
5. **Test Queries**: Verify all tables work

See `DATABASE_SETUP_GUIDE.md` for detailed instructions.
