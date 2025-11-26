-- Demo Users for IronGate QA Navigator
-- Password for all users: demo123
-- Run this after seed_data.sql



-- Insert demo users
-- Password hash for 'demo123' using bcrypt with 10 rounds
-- Hash: $2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC

INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified) VALUES
-- Super Admin
('user-admin', 'admin@irongate.com', '$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC', 'Admin', 'User', 'super_admin', 'company-mastercard', 'dept-decision-mgmt', 'team-quasars', true, true),

-- QA Manager
('user-manager', 'manager@irongate.com', '$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC', 'QA', 'Manager', 'qa_manager', 'company-mastercard', 'dept-decision-mgmt', 'team-pulsars', true, true),

-- Team Lead
('user-lead', 'lead@irongate.com', '$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC', 'Team', 'Lead', 'team_lead', 'company-mastercard', 'dept-decision-mgmt', 'team-watchmen', true, true),

-- QA Engineer
('user-engineer', 'engineer@irongate.com', '$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC', 'QA', 'Engineer', 'qa_engineer', 'company-mastercard', 'dept-decision-mgmt', 'team-quasars', true, true),

-- Viewer
('user-viewer', 'viewer@irongate.com', '$2b$10$WQpcuEcTOreEzXIOPXMkSOUxw4ycW7G6.EqTeHTH2ignvfSmW9WsC', 'View', 'Only', 'viewer', 'company-mastercard', 'dept-decision-mgmt', 'team-grid', true, true);

-- Add users to their teams
INSERT INTO team_members (user_id, team_id, role) VALUES
('user-admin', 'team-quasars', 'lead'),
('user-manager', 'team-pulsars', 'lead'),
('user-lead', 'team-watchmen', 'lead'),
('user-engineer', 'team-quasars', 'member'),
('user-viewer', 'team-grid', 'member');

-- Verify
SELECT 'Demo users created successfully!' as message;
SELECT id, email, first_name, last_name, role FROM users WHERE email LIKE '%@irongate.com';
