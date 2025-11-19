# 📊 Database Entity Relationship Diagram

## Complete ERD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IRONGATE QA NAVIGATOR - DATABASE ERD                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│     USERS        │
├──────────────────┤
│ PK id            │
│    email         │◀────────────┐
│    password_hash │             │
│    first_name    │             │
│    last_name     │             │
│    role          │             │
│    avatar_url    │             │
│    is_active     │             │
│    email_verified│             │
│    created_at    │             │
│    updated_at    │             │
└──────────────────┘             │
        │                        │
        │ 1:N                    │
        ▼                        │
┌──────────────────┐             │
│    SESSIONS      │             │
├──────────────────┤             │
│ PK id            │             │
│ FK user_id       │─────────────┘
│    token         │
│    refresh_token │
│    ip_address    │
│    user_agent    │
│    expires_at    │
│    created_at    │
└──────────────────┘

        │
        │ 1:N
        ▼
┌──────────────────┐
│   AUDIT_LOGS     │
├──────────────────┤
│ PK id            │
│ FK user_id       │
│    action        │
│    entity_type   │
│    entity_id     │
│    old_values    │
│    new_values    │
│    ip_address    │
│    created_at    │
└──────────────────┘


┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│     USERS        │         │   USER_TEAMS     │         │      TEAMS       │
├──────────────────┤         ├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │◀────────│ PK id            │
│    email         │   1:N   │ FK user_id       │   N:1   │    name          │
│    ...           │         │ FK team_id       │         │    department    │
└──────────────────┘         │    role          │         │    description   │
                             │    joined_at     │         │    status        │
                             └──────────────────┘         │    created_by    │
                                                          │    created_at    │
                                                          └──────────────────┘
                                                                   │
                                                                   │ 1:N
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  TEAM_METRICS    │
                                                          ├──────────────────┤
                                                          │ PK id            │
                                                          │ FK team_id       │
                                                          │    metric_date   │
                                                          │    qa_score      │
                                                          │    test_coverage │
                                                          │    flakiness_rate│
                                                          │    defect_density│
                                                          │    build_time    │
                                                          │    sprint_velocity│
                                                          │    ...           │
                                                          └──────────────────┘


┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │   TEST_CASES     │         │ TEST_EXECUTIONS  │
├──────────────────┤         ├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │   1:N   │ FK test_case_id  │
│    ...           │         │    title         │         │ FK team_id       │
└──────────────────┘         │    description   │         │ FK executed_by   │
                             │    type          │         │    status        │
                             │    priority      │         │    duration      │
                             │    status        │         │    error_message │
                             │    requirements  │         │    executed_at   │
                             │    created_by    │         └──────────────────┘
                             │    created_at    │
                             └──────────────────┘
                                      │
                                      │ 1:1
                                      ▼
                             ┌──────────────────┐
                             │   FLAKY_TESTS    │
                             ├──────────────────┤
                             │ PK id            │
                             │ FK test_case_id  │
                             │ FK team_id       │
                             │    flakiness_score│
                             │    total_runs    │
                             │    failed_runs   │
                             │    pattern       │
                             │    suggested_fix │
                             │    status        │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │     BUILDS       │         │ PIPELINE_STAGES  │
├──────────────────┤         ├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │   1:N   │ FK build_id      │
│    ...           │         │    build_number  │         │    stage_name    │
└──────────────────┘         │    branch        │         │    stage_order   │
                             │    commit_sha    │         │    status        │
                             │    status        │         │    duration      │
                             │    duration      │         │    started_at    │
                             │    started_at    │         │    completed_at  │
                             │    completed_at  │         └──────────────────┘
                             │    triggered_by  │
                             └──────────────────┘
                                      │
                                      │ 1:N
                                      ▼
                             ┌──────────────────┐
                             │   DEPLOYMENTS    │
                             ├──────────────────┤
                             │ PK id            │
                             │ FK team_id       │
                             │ FK build_id      │
                             │    environment   │
                             │    version       │
                             │    status        │
                             │    deployed_by   │
                             │    deployed_at   │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │ TECHNICAL_DEBT   │
├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │
│    ...           │         │    title         │
└──────────────────┘         │    description   │
                             │    category      │
                             │    severity      │
                             │    effort_hours  │
                             │    cost_of_delay │
                             │    priority_score│
                             │    status        │
                             │    assigned_to   │
                             │    created_at    │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │PERFORMANCE_TESTS │
├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │
│    ...           │         │    test_name     │
└──────────────────┘         │    endpoint      │
                             │    method        │
                             │    concurrent_users│
                             │    response_time_p50│
                             │    response_time_p95│
                             │    response_time_p99│
                             │    requests_per_sec│
                             │    error_rate    │
                             │    executed_at   │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │ BUSINESS_METRICS │
├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │
│    ...           │         │    metric_date   │
└──────────────────┘         │    revenue       │
                             │    customer_satisfaction│
                             │    feature_adoption_rate│
                             │    production_incidents│
                             │    created_at    │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │TEAM_ACHIEVEMENTS │         │  ACHIEVEMENTS    │
├──────────────────┤         ├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │◀────────│ PK id            │
│    name          │   1:N   │ FK team_id       │   N:1   │    code          │
│    ...           │         │ FK achievement_id│         │    name          │
└──────────────────┘         │    earned_at     │         │    description   │
        │                    │    evidence      │         │    icon          │
        │                    └──────────────────┘         │    category      │
        │ 1:N                                             │    points        │
        ▼                                                 │    criteria      │
┌──────────────────┐                                      └──────────────────┘
│   TEAM_POINTS    │
├──────────────────┤
│ PK id            │
│ FK team_id       │
│    points        │
│    reason        │
│    category      │
│    awarded_at    │
└──────────────────┘


┌──────────────────┐         ┌──────────────────┐
│      USERS       │         │  NOTIFICATIONS   │
├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │
│    email         │   1:N   │ FK user_id       │
│    ...           │         │    title         │
└──────────────────┘         │    message       │
                             │    type          │
                             │    category      │
                             │    link          │
                             │    read_at       │
                             │    created_at    │
                             └──────────────────┘


┌──────────────────┐         ┌──────────────────┐
│      TEAMS       │         │   ALERT_RULES    │
├──────────────────┤         ├──────────────────┤
│ PK id            │────────▶│ PK id            │
│    name          │   1:N   │ FK team_id       │
│    ...           │         │    name          │
└──────────────────┘         │    metric_name   │
                             │    condition     │
                             │    threshold     │
                             │    severity      │
                             │    notify_users  │
                             │    is_active     │
                             └──────────────────┘
```

---

## Table Relationships Summary

### Core Entities

| Entity | Related To | Relationship | Description |
|--------|-----------|--------------|-------------|
| **users** | sessions | 1:N | One user can have multiple sessions |
| **users** | user_teams | 1:N | One user can belong to multiple teams |
| **users** | audit_logs | 1:N | One user can have multiple audit entries |
| **users** | notifications | 1:N | One user can have multiple notifications |
| **teams** | user_teams | 1:N | One team can have multiple users |
| **teams** | team_metrics | 1:N | One team has metrics over time |
| **teams** | test_cases | 1:N | One team has multiple test cases |
| **teams** | builds | 1:N | One team has multiple builds |
| **teams** | technical_debt | 1:N | One team has multiple debt items |

### Test Management

| Entity | Related To | Relationship | Description |
|--------|-----------|--------------|-------------|
| **test_cases** | test_executions | 1:N | One test case has multiple executions |
| **test_cases** | flaky_tests | 1:1 | One test case can be marked as flaky |
| **test_executions** | users | N:1 | Executions are performed by users |

### CI/CD

| Entity | Related To | Relationship | Description |
|--------|-----------|--------------|-------------|
| **builds** | pipeline_stages | 1:N | One build has multiple stages |
| **builds** | deployments | 1:N | One build can have multiple deployments |
| **deployments** | teams | N:1 | Deployments belong to teams |

### Gamification

| Entity | Related To | Relationship | Description |
|--------|-----------|--------------|-------------|
| **teams** | team_achievements | 1:N | One team can earn multiple achievements |
| **achievements** | team_achievements | 1:N | One achievement can be earned by multiple teams |
| **teams** | team_points | 1:N | One team has multiple point entries |

---

## Key Constraints

### Primary Keys
- All tables use UUID as primary key
- Format: `uuid_generate_v4()`

### Foreign Keys
- All foreign keys have `ON DELETE CASCADE` or `ON DELETE SET NULL`
- Maintains referential integrity

### Unique Constraints
- `users.email` - One email per user
- `teams.name` + `teams.department` - Unique team names per department
- `user_teams(user_id, team_id)` - User can only join team once
- `team_metrics(team_id, metric_date)` - One metric snapshot per day

### Check Constraints
- `users.role` - Must be valid role
- `test_cases.type` - Must be valid test type
- `test_executions.status` - Must be valid status
- `builds.status` - Must be valid build status

---

## Indexes Strategy

### Performance Indexes
```sql
-- Frequently queried columns
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_teams_department ON teams(department);
CREATE INDEX idx_team_metrics_team_date ON team_metrics(team_id, metric_date DESC);

-- Foreign key indexes
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_user_teams_user ON user_teams(user_id);
CREATE INDEX idx_user_teams_team ON user_teams(team_id);

-- Composite indexes for common queries
CREATE INDEX idx_test_executions_team_date ON test_executions(team_id, executed_at DESC);
CREATE INDEX idx_builds_team_status ON builds(team_id, status);
```

### Partial Indexes
```sql
-- Index only active records
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;
```

---

## Data Flow Examples

### User Login Flow
```
1. Query: users (by email)
2. Validate password
3. Create: sessions (new session)
4. Create: audit_logs (login event)
5. Update: users.last_login
```

### Test Execution Flow
```
1. Query: test_cases (by team_id)
2. Create: test_executions (new execution)
3. Update: test_cases (last_executed)
4. Check: flaky_tests (if failure pattern)
5. Create: flaky_tests (if detected)
6. Update: team_metrics (aggregate stats)
```

### Build Pipeline Flow
```
1. Create: builds (new build)
2. Create: pipeline_stages (for each stage)
3. Update: pipeline_stages (as they complete)
4. Update: builds (final status)
5. Create: deployments (if successful)
6. Update: team_metrics (build stats)
```

---

## Scaling Considerations

### Partitioning Strategy

```sql
-- Partition team_metrics by date (monthly)
CREATE TABLE team_metrics_2024_11 PARTITION OF team_metrics
FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

-- Partition test_executions by date (monthly)
CREATE TABLE test_executions_2024_11 PARTITION OF test_executions
FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');
```

### Archival Strategy

```sql
-- Archive old audit logs (older than 1 year)
CREATE TABLE audit_logs_archive AS
SELECT * FROM audit_logs WHERE created_at < NOW() - INTERVAL '1 year';

DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '1 year';
```

---

## Query Examples

### Get Team Dashboard Data
```sql
SELECT 
    t.id,
    t.name,
    t.department,
    tm.qa_score,
    tm.test_coverage,
    tm.defect_escape_rate,
    COUNT(DISTINCT ut.user_id) as member_count,
    COUNT(DISTINCT tc.id) as test_case_count
FROM teams t
LEFT JOIN team_metrics tm ON t.id = tm.team_id AND tm.metric_date = CURRENT_DATE
LEFT JOIN user_teams ut ON t.id = ut.team_id
LEFT JOIN test_cases tc ON t.id = tc.team_id
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.name, t.department, tm.qa_score, tm.test_coverage, tm.defect_escape_rate;
```

### Get User's Teams and Permissions
```sql
SELECT 
    u.id,
    u.email,
    u.role as user_role,
    t.id as team_id,
    t.name as team_name,
    ut.role as team_role
FROM users u
JOIN user_teams ut ON u.id = ut.user_id
JOIN teams t ON ut.team_id = t.id
WHERE u.email = 'user@example.com'
AND u.deleted_at IS NULL
AND t.deleted_at IS NULL;
```

### Get Flaky Tests Report
```sql
SELECT 
    t.name as team_name,
    tc.title as test_name,
    ft.flakiness_score,
    ft.total_runs,
    ft.failed_runs,
    ft.pattern,
    ft.last_failure_at
FROM flaky_tests ft
JOIN test_cases tc ON ft.test_case_id = tc.id
JOIN teams t ON ft.team_id = t.id
WHERE ft.status = 'open'
ORDER BY ft.flakiness_score DESC
LIMIT 10;
```

---

**Complete database structure ready for implementation!** 🗄️
