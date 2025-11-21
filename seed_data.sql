-- Seed Data for IronGate QA Navigator
-- Run this after importing schema.sql

USE irongate_qa;

-- ============================================================================
-- COMPANY
-- ============================================================================

INSERT INTO companies (id, name, domain, is_active) 
VALUES ('company-mastercard', 'Mastercard', 'mastercard.com', true);

-- ============================================================================
-- DEPARTMENTS
-- ============================================================================

INSERT INTO departments (id, company_id, name, description, is_active) VALUES
('dept-decision-mgmt', 'company-mastercard', 'Decision Management', 'AI-powered decision management and fraud detection', true),
('dept-payments', 'company-mastercard', 'Payments Processing', 'Core payment processing and transaction management', true),
('dept-security', 'company-mastercard', 'Security & Compliance', 'Security, fraud prevention, and regulatory compliance', true),
('dept-digital', 'company-mastercard', 'Digital Products', 'Mobile apps, web portals, and digital experiences', true);

-- ============================================================================
-- TEAMS
-- ============================================================================

-- Decision Management Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-quasars', 'company-mastercard', 'dept-decision-mgmt', 'Nebula', 'AI/ML decision engine development', 'Backend', true),
('team-pulsars', 'company-mastercard', 'dept-decision-mgmt', 'Voyagers', 'Real-time decision processing', 'API', true),
('team-watchmen', 'company-mastercard', 'dept-decision-mgmt', 'Sentinels', 'Monitoring and alerting systems', 'DevOps', true),
('team-astronauts', 'company-mastercard', 'dept-decision-mgmt', 'Pioneers', 'Exploration and innovation team', 'Web', true),
('team-black-comb', 'company-mastercard', 'dept-decision-mgmt', 'Horizon', 'Data analytics and insights', 'Backend', true),
('team-grid', 'company-mastercard', 'dept-decision-mgmt', 'Atlas', 'Infrastructure and platform services', 'DevOps', true);

-- Payments Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-payment-core', 'company-mastercard', 'dept-payments', 'Nexus', 'Core payment processing engine', 'Backend', true),
('team-settlement', 'company-mastercard', 'dept-payments', 'Ledger', 'Transaction settlement and reconciliation', 'Backend', true),
('team-gateway', 'company-mastercard', 'dept-payments', 'Portal', 'Payment gateway and API services', 'API', true);

-- Security Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-fraud-detection', 'company-mastercard', 'dept-security', 'Guardians', 'Real-time fraud detection and prevention', 'Backend', true),
('team-compliance', 'company-mastercard', 'dept-security', 'Vanguard', 'Regulatory compliance and audit', 'Security', true);

-- Digital Teams
INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active) VALUES
('team-mobile-ios', 'company-mastercard', 'dept-digital', 'Catalyst iOS', 'iOS mobile application', 'Mobile', true),
('team-mobile-android', 'company-mastercard', 'dept-digital', 'Catalyst Android', 'Android mobile application', 'Mobile', true),
('team-web-portal', 'company-mastercard', 'dept-digital', 'Zenith', 'Customer web portal', 'Web', true);

-- ============================================================================
-- VERIFY
-- ============================================================================

SELECT 'Seed data inserted successfully!' as message;
SELECT COUNT(*) as company_count FROM companies;
SELECT COUNT(*) as department_count FROM departments;
SELECT COUNT(*) as team_count FROM teams;

-- Show all teams by department
SELECT 
    d.name as department,
    t.name as team,
    t.platform
FROM teams t
JOIN departments d ON t.department_id = d.id
ORDER BY d.name, t.name;
