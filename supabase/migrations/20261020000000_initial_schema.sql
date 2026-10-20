-- IronGate QA Navigator: initial PostgreSQL schema (converted from MySQL by scripts/mysql-to-postgres.ts)
-- Apply with: psql "$DATABASE_URL" -f supabase/migrations/20261020000000_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Replaces MySQL's "ON UPDATE CURRENT_TIMESTAMP"
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE "business_impact_business_kpis" (
  "id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "month_year" varchar(7) NOT NULL,
  "monthly_revenue" numeric(15,2),
  "active_users" integer,
  "churn_rate" numeric(5,2),
  "feature_adoption_rate" numeric(5,2),
  "new_customers" integer,
  "customer_lifetime_value" numeric(12,2),
  "nps_score" numeric(5,2),
  "csat_score" numeric(5,2),
  "support_ticket_volume" integer,
  "avg_resolution_time_hours" numeric(8,2),
  "manually_edited" boolean DEFAULT false,
  "data_source" varchar(100) DEFAULT 'manual',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_business_kpis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_business_kpis_unique_team_month_kpi" UNIQUE ("team_id", "month_year")
);

CREATE TABLE "business_impact_config" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "metric_name" varchar(100) NOT NULL,
  "quality_score" numeric(5,2) DEFAULT 0.00,
  "revenue_impact" numeric(12,2) DEFAULT 0.00,
  "customer_satisfaction" numeric(5,2) DEFAULT 0.00,
  "feature_adoption_rate" numeric(5,2) DEFAULT 0.00,
  "correlation_strength" numeric(3,2) DEFAULT 0.00,
  "manually_edited" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_config_unique_team_metric" UNIQUE ("team_id", "metric_name")
);

CREATE TABLE "business_impact_context" (
  "id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "month_year" varchar(7) NOT NULL,
  "team_size" integer,
  "sprint_length_days" integer DEFAULT 14,
  "working_days" integer,
  "feature_release_count" integer,
  "bug_fix_count" integer,
  "tech_debt_items_resolved" integer,
  "user_growth_rate" numeric(5,2),
  "total_user_base" integer,
  "is_holiday_season" boolean DEFAULT false,
  "marketing_spend" numeric(12,2),
  "major_incident_count" integer DEFAULT 0,
  "downtime_minutes" integer DEFAULT 0,
  "notes" text,
  "manually_edited" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_context_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_context_unique_team_month_context" UNIQUE ("team_id", "month_year")
);

CREATE TABLE "business_impact_correlations" (
  "id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "quality_metric" varchar(50) NOT NULL,
  "business_kpi" varchar(50) NOT NULL,
  "pearson_correlation" numeric(4,3),
  "p_value" numeric(10,8),
  "sample_size" integer,
  "confidence_level" numeric(5,2) DEFAULT 95.00,
  "start_month" varchar(7) NOT NULL,
  "end_month" varchar(7) NOT NULL,
  "correlation_strength" varchar(20),
  "is_significant" boolean DEFAULT false,
  "calculated_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_correlations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_correlations_unique_correlation_pair" UNIQUE ("team_id", "quality_metric", "business_kpi")
);

CREATE TABLE "business_impact_data_status" (
  "id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "months_with_quality_data" integer DEFAULT 0,
  "months_with_kpi_data" integer DEFAULT 0,
  "months_with_paired_data" integer DEFAULT 0,
  "earliest_month" varchar(7),
  "latest_month" varchar(7),
  "is_correlation_ready" boolean DEFAULT false,
  "missing_quality_metrics" text,
  "missing_kpi_metrics" text,
  "last_validated_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_data_status_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_data_status_unique_team_status" UNIQUE ("team_id")
);

CREATE TABLE "business_impact_history" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "month_year" varchar(20) NOT NULL,
  "quality_score" numeric(5,2) DEFAULT 0.00,
  "revenue_impact" numeric(12,2) DEFAULT 0.00,
  "customer_satisfaction" numeric(5,2) DEFAULT 0.00,
  "churn_rate" numeric(5,2) DEFAULT 0.00,
  "manually_edited" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_history_unique_team_month" UNIQUE ("team_id", "month_year")
);

CREATE TABLE "business_impact_metrics" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "metric_name" varchar(100) NOT NULL,
  "quality_score" numeric(5,2) DEFAULT 0.00,
  "revenue_impact" numeric(15,2) DEFAULT 0.00,
  "customer_satisfaction" numeric(5,2) DEFAULT 0.00,
  "feature_adoption_rate" numeric(5,2) DEFAULT 0.00,
  "correlation_strength" numeric(5,4) DEFAULT 0.0000,
  "recorded_date" date NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_metrics_unique_metric_date" UNIQUE ("company_id", "metric_name", "recorded_date")
);

CREATE TABLE "business_impact_quality_metrics" (
  "id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "month_year" varchar(7) NOT NULL,
  "test_coverage" numeric(5,2),
  "defect_density" numeric(8,4),
  "defect_escape_rate" numeric(5,2),
  "mttr_hours" numeric(8,2),
  "deployment_frequency" numeric(8,2),
  "lead_time_days" numeric(8,2),
  "code_quality_score" numeric(5,2),
  "change_failure_rate" numeric(5,2),
  "manually_edited" boolean DEFAULT false,
  "data_source" varchar(100) DEFAULT 'manual',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_impact_quality_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_impact_quality_metrics_unique_team_month_quality" UNIQUE ("team_id", "month_year")
);

CREATE TABLE "business_metrics" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "metric_date" date NOT NULL,
  "revenue" numeric(15,2),
  "mrr" numeric(15,2),
  "arr" numeric(15,2),
  "customer_satisfaction_nps" integer,
  "customer_satisfaction_csat" numeric(5,2),
  "churn_rate" numeric(5,2),
  "feature_adoption_rate" numeric(5,2),
  "support_ticket_volume" integer,
  "user_engagement_score" numeric(5,2),
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "business_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_metrics_unique_company_metric_date" UNIQUE ("company_id", "metric_date")
);

CREATE TABLE "companies" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "name" varchar(255) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "logo_url" text,
  "settings" jsonb,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "is_active" boolean DEFAULT true,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companies_domain" UNIQUE ("domain")
);

CREATE TABLE "company_kpi_snapshots" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "company_id" varchar(50) NOT NULL,
  "snapshot_date" date NOT NULL,
  "engineering_health_score" numeric(5,2),
  "delivery_performance_score" numeric(5,2),
  "developer_wellness_index" numeric(5,2),
  "tech_debt_status_score" numeric(5,2),
  "pipeline_health_score" numeric(5,2),
  "avg_qa_score" numeric(5,2),
  "avg_test_coverage" numeric(5,2),
  "avg_defect_escape_rate" numeric(5,2),
  "avg_flakiness_rate" numeric(5,2),
  "automation_coverage" numeric(5,2),
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "company_kpi_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_kpi_snapshots_unique_company_date" UNIQUE ("company_id", "snapshot_date")
);

CREATE TABLE "configs" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "department_id" varchar(36),
  "team_id" varchar(36),
  "config_key" varchar(100) NOT NULL,
  "config_value" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configs_unique_config_scope" UNIQUE ("company_id", "department_id", "team_id", "config_key")
);

CREATE TABLE "departments" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "manager_id" varchar(36),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "is_active" boolean DEFAULT true,
  CONSTRAINT "departments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "departments_unique_dept_per_company" UNIQUE ("company_id", "name")
);

CREATE TABLE "developer_metrics" (
  "id" varchar(50) DEFAULT ('dm-' || floor(extract(epoch from now()))::bigint || '-' || substr(gen_random_uuid()::text, 1, 8)) NOT NULL,
  "team_id" varchar(50) NOT NULL,
  "developer_id" varchar(50) NOT NULL,
  "pr_merge_time_avg" numeric(10,2) DEFAULT 0.00,
  "code_review_time_avg" numeric(10,2) DEFAULT 0.00,
  "focus_time_hours" numeric(10,2) DEFAULT 0.00,
  "meeting_time_hours" numeric(10,2) DEFAULT 0.00,
  "context_switches_per_day" integer DEFAULT 0,
  "happiness_score" numeric(3,1) DEFAULT 0.0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "developer_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "developer_metrics_unique_team_developer" UNIQUE ("team_id", "developer_id")
);

CREATE TABLE "developer_productivity_snapshots" (
  "id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "developer_id" varchar(100) NOT NULL,
  "snapshot_date" date NOT NULL,
  "focus_time_hours" numeric(5,2) DEFAULT 0.00,
  "pr_merge_time_avg" numeric(5,2) DEFAULT 0.00,
  "code_review_time_avg" numeric(5,2) DEFAULT 0.00,
  "meeting_time_hours" numeric(5,2) DEFAULT 0.00,
  "context_switches_per_day" integer DEFAULT 0,
  "focus_time_norm" numeric(5,4) DEFAULT 0.0000,
  "pr_time_norm" numeric(5,4) DEFAULT 0.0000,
  "review_time_norm" numeric(5,4) DEFAULT 0.0000,
  "meeting_time_norm" numeric(5,4) DEFAULT 0.0000,
  "context_switches_norm" numeric(5,4) DEFAULT 0.0000,
  "ddps_score" numeric(5,4) DEFAULT 0.0000,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "developer_productivity_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "developer_productivity_snapshots_unique_developer_date" UNIQUE ("developer_id", "snapshot_date")
);

CREATE TABLE "flaky_tests" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "test_case_id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "company_id" varchar(36),
  "test_name" varchar(255),
  "failure_pattern" text DEFAULT 'unknown' CHECK ("failure_pattern" IN ('timing', 'environment', 'data', 'network', 'unknown')),
  "flakiness_score" numeric(5,2) DEFAULT 0.00,
  "failure_count" integer DEFAULT 0,
  "pass_count" integer DEFAULT 0,
  "total_runs" integer DEFAULT 0,
  "last_flaky_at" timestamptz,
  "root_cause" varchar(255),
  "suggested_fix" text,
  "is_quarantined" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "flaky_tests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "flaky_tests_unique_flaky_test" UNIQUE ("test_case_id")
);

CREATE TABLE "kpi_snapshots" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "snapshot_date" date NOT NULL,
  "test_coverage" numeric(5,2),
  "test_flakiness_rate" numeric(5,2),
  "defect_density" numeric(6,3),
  "defect_escape_rate" numeric(5,2),
  "code_quality_score" integer,
  "avg_build_time_minutes" integer,
  "test_execution_time_minutes" integer,
  "deployment_frequency_per_week" integer,
  "lead_time_days" numeric(4,2),
  "mttr_hours" numeric(6,2),
  "parallel_test_efficiency" numeric(5,2),
  "sprint_velocity" integer,
  "sprint_commitment_rate" numeric(5,2),
  "sprint_carryover" numeric(5,2),
  "first_time_pass_rate" numeric(5,2),
  "blocked_time_hours" integer,
  "automation_coverage" numeric(5,2),
  "automation_roi" numeric(6,2),
  "change_failure_rate" numeric(5,2),
  "mtbf_hours" integer,
  "system_availability" numeric(5,3),
  "infrastructure_failures" integer,
  "qa_score" integer,
  "status" text CHECK ("status" IN ('good', 'warning', 'critical')),
  "created_at" timestamptz DEFAULT now(),
  "manually_edited" boolean DEFAULT false,
  "sizing_accuracy" numeric(4,2),
  CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kpi_snapshots_unique_team_snapshot_date" UNIQUE ("team_id", "snapshot_date")
);

CREATE TABLE "metric_last_updated" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "metric_key" varchar(100) NOT NULL,
  "last_updated_at" timestamptz DEFAULT now() NOT NULL,
  "next_update_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "metric_last_updated_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_last_updated_unique_team_metric" UNIQUE ("team_id", "metric_key")
);

CREATE TABLE "metric_update_intervals" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "metric_key" varchar(100) NOT NULL,
  "interval_value" integer NOT NULL,
  "interval_unit" text DEFAULT 'days' NOT NULL CHECK ("interval_unit" IN ('minutes', 'hours', 'days', 'weeks', 'months')),
  "custom_label" varchar(100),
  "updated_by" varchar(36),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "metric_update_intervals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "metric_update_intervals_unique_company_metric" UNIQUE ("company_id", "metric_key")
);

CREATE TABLE "performance_metrics" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "recorded_date" date NOT NULL,
  "endpoint" varchar(500),
  "method" varchar(10) DEFAULT 'GET',
  "response_time_p50_ms" integer,
  "response_time_p95_ms" integer,
  "response_time_p99_ms" integer,
  "throughput_per_minute" integer,
  "error_rate" numeric(5,2),
  "cpu_usage_avg" numeric(5,2),
  "memory_usage_avg" numeric(5,2),
  "disk_io_avg" numeric(10,2),
  "network_io_avg" numeric(10,2),
  "db_query_time_avg_ms" integer,
  "db_connections_avg" integer,
  "slow_queries_count" integer,
  "page_load_time_ms" integer,
  "first_contentful_paint_ms" integer,
  "largest_contentful_paint_ms" integer,
  "time_to_interactive_ms" integer,
  "created_at" timestamptz DEFAULT now(),
  "company_id" varchar(36),
  CONSTRAINT "performance_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_config" (
  "id" varchar(36) NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "time_savings_percent" numeric(5,2) DEFAULT 30.00,
  "cost_savings_percent" numeric(5,2) DEFAULT 25.00,
  "cost_per_minute" numeric(10,4) DEFAULT 0.5000,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "pipeline_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_config_unique_company_config" UNIQUE ("company_id")
);

CREATE TABLE "pipeline_execution_summary" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36),
  "stage_id" varchar(36) NOT NULL,
  "execution_date" date NOT NULL,
  "total_runs" integer DEFAULT 0,
  "successful_runs" integer DEFAULT 0,
  "failed_runs" integer DEFAULT 0,
  "avg_duration_seconds" integer DEFAULT 0,
  "min_duration_seconds" integer DEFAULT 0,
  "max_duration_seconds" integer DEFAULT 0,
  "total_cost" numeric(10,2) DEFAULT 0.00,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "pipeline_execution_summary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pipeline_execution_summary_unique_stage_date" UNIQUE ("company_id", "stage_id", "execution_date")
);

CREATE TABLE "pipeline_runs" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36),
  "stage_id" varchar(36) NOT NULL,
  "status" text DEFAULT 'running' NOT NULL CHECK ("status" IN ('success', 'failed', 'running', 'cancelled')),
  "duration_seconds" integer DEFAULT 0,
  "triggered_by" varchar(100),
  "commit_sha" varchar(40),
  "branch" varchar(100),
  "started_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz,
  "error_message" text,
  CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_stage_history" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "stage_id" varchar(36) NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36),
  "name" varchar(100) NOT NULL,
  "duration_seconds" integer DEFAULT 0,
  "success_rate" numeric(5,2) DEFAULT 100.00,
  "cpu_usage" numeric(5,2) DEFAULT 0.00,
  "memory_usage" numeric(5,2) DEFAULT 0.00,
  "cost_per_run" numeric(10,2) DEFAULT 0.00,
  "bottleneck_score" numeric(5,2) DEFAULT 0.00,
  "recorded_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_stage_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_stages" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36),
  "name" varchar(100) NOT NULL,
  "stage_order" integer DEFAULT 0 NOT NULL,
  "avg_duration_seconds" integer DEFAULT 0,
  "success_rate" numeric(5,2) DEFAULT 100.00,
  "cpu_usage" numeric(5,2) DEFAULT 0.00,
  "memory_usage" numeric(5,2) DEFAULT 0.00,
  "cost_per_run" numeric(10,2) DEFAULT 0.00,
  "bottleneck_score" numeric(5,2) DEFAULT 0.00,
  "manually_edited" boolean DEFAULT false,
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seeder_runs" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "seeder_name" varchar(100) NOT NULL,
  "company_id" varchar(36),
  "last_run_at" timestamptz DEFAULT now() NOT NULL,
  "records_affected" integer DEFAULT 0,
  "status" text DEFAULT 'success' CHECK ("status" IN ('success', 'failed')),
  "error_message" text,
  CONSTRAINT "seeder_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sprint_velocity" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "sprint_name" varchar(50) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "committed_points" integer NOT NULL,
  "delivered_points" integer NOT NULL,
  "carryover_points" integer DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "sprint_velocity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sprint_velocity_unique_team_sprint" UNIQUE ("team_id", "sprint_name")
);

CREATE TABLE "team_analytics" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "period_type" text DEFAULT 'weekly' CHECK ("period_type" IN ('daily', 'weekly', 'monthly', 'quarterly')),
  "total_test_cases" integer DEFAULT 0,
  "passed_tests" integer DEFAULT 0,
  "failed_tests" integer DEFAULT 0,
  "skipped_tests" integer DEFAULT 0,
  "test_pass_rate" numeric(5,2) DEFAULT 0.00,
  "avg_test_duration_seconds" numeric(10,2) DEFAULT 0.00,
  "flaky_test_count" integer DEFAULT 0,
  "code_coverage" numeric(5,2) DEFAULT 0.00,
  "code_churn" integer DEFAULT 0,
  "lines_added" integer DEFAULT 0,
  "lines_removed" integer DEFAULT 0,
  "deployment_count" integer DEFAULT 0,
  "successful_deployments" integer DEFAULT 0,
  "failed_deployments" integer DEFAULT 0,
  "rollback_count" integer DEFAULT 0,
  "avg_deployment_time_minutes" numeric(10,2) DEFAULT 0.00,
  "bugs_created" integer DEFAULT 0,
  "bugs_resolved" integer DEFAULT 0,
  "bugs_open" integer DEFAULT 0,
  "critical_bugs" integer DEFAULT 0,
  "avg_bug_resolution_hours" numeric(10,2) DEFAULT 0.00,
  "story_points_committed" integer DEFAULT 0,
  "story_points_completed" integer DEFAULT 0,
  "velocity" numeric(5,2) DEFAULT 0.00,
  "carryover_points" integer DEFAULT 0,
  "avg_pr_merge_time_hours" numeric(10,2) DEFAULT 0.00,
  "avg_code_review_time_hours" numeric(10,2) DEFAULT 0.00,
  "total_prs_merged" integer DEFAULT 0,
  "total_code_reviews" integer DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  CONSTRAINT "team_analytics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_analytics_unique_team_period" UNIQUE ("team_id", "period_start", "period_end", "period_type")
);

CREATE TABLE "team_members" (
  "user_id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "role" text DEFAULT 'member' CHECK ("role" IN ('lead', 'member', 'contributor')),
  "joined_at" timestamptz DEFAULT now(),
  CONSTRAINT "team_members_pkey" PRIMARY KEY ("user_id", "team_id")
);

CREATE TABLE "team_pipeline_metrics" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "recorded_date" date NOT NULL,
  "total_builds" integer DEFAULT 0,
  "successful_builds" integer DEFAULT 0,
  "failed_builds" integer DEFAULT 0,
  "build_success_rate" numeric(5,2) DEFAULT 0.00,
  "avg_build_time_minutes" numeric(10,2) DEFAULT 0.00,
  "avg_queue_time_minutes" numeric(10,2) DEFAULT 0.00,
  "avg_compile_time_minutes" numeric(10,2) DEFAULT 0.00,
  "avg_test_time_minutes" numeric(10,2) DEFAULT 0.00,
  "avg_deploy_time_minutes" numeric(10,2) DEFAULT 0.00,
  "slowest_stage" varchar(100),
  "most_failing_stage" varchar(100),
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "team_pipeline_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_pipeline_metrics_unique_team_date" UNIQUE ("team_id", "recorded_date")
);

CREATE TABLE "team_test_executions" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "execution_date" date NOT NULL,
  "total_tests" integer DEFAULT 0,
  "passed" integer DEFAULT 0,
  "failed" integer DEFAULT 0,
  "skipped" integer DEFAULT 0,
  "blocked" integer DEFAULT 0,
  "total_duration_seconds" integer DEFAULT 0,
  "avg_duration_seconds" numeric(10,2) DEFAULT 0.00,
  "unit_tests" integer DEFAULT 0,
  "integration_tests" integer DEFAULT 0,
  "e2e_tests" integer DEFAULT 0,
  "api_tests" integer DEFAULT 0,
  "environment" varchar(50) DEFAULT 'staging',
  "build_number" varchar(100),
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "team_test_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "teams" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "department_id" varchar(36) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "lead_id" varchar(36),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "is_active" boolean DEFAULT true,
  "ai_enabled" boolean DEFAULT false,
  "exclude_from_auto_sync" boolean DEFAULT false,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teams_unique_team_per_company_dept" UNIQUE ("company_id", "department_id", "name")
);

CREATE TABLE "technical_debt" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "title" varchar(500) NOT NULL,
  "description" text,
  "severity" text DEFAULT 'medium' CHECK ("severity" IN ('critical', 'high', 'medium', 'low')),
  "category" text DEFAULT 'code_quality' CHECK ("category" IN ('code_quality', 'testing', 'documentation', 'infrastructure', 'security', 'performance')),
  "impact_score" integer DEFAULT 0,
  "effort_hours" numeric(10,2),
  "status" text DEFAULT 'open' CHECK ("status" IN ('open', 'in_progress', 'resolved', 'wont_fix')),
  "source" varchar(100),
  "file_path" varchar(500),
  "line_number" integer,
  "assigned_to" varchar(36),
  "created_by" varchar(36),
  "resolved_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "company_id" varchar(36),
  "cost_of_delay" numeric(10,2) DEFAULT 0.00,
  "priority_score" numeric(5,2) DEFAULT 0.00,
  "affected_users" integer DEFAULT 0,
  "support_tickets_monthly" integer DEFAULT 0,
  "downtime_minutes_monthly" integer DEFAULT 0,
  "revenue_impact_percent" numeric(5,2) DEFAULT 0.00,
  "sla_breaches_monthly" integer DEFAULT 0,
  "manually_edited" boolean DEFAULT false,
  CONSTRAINT "technical_debt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_case_tags" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "test_case_id" varchar(36) NOT NULL,
  "tag" varchar(100) NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "test_case_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_cases" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "name" varchar(500) NOT NULL,
  "description" text,
  "test_type" text DEFAULT 'unit' CHECK ("test_type" IN ('unit', 'integration', 'e2e', 'api', 'performance', 'security', 'manual')),
  "priority" text DEFAULT 'medium' CHECK ("priority" IN ('critical', 'high', 'medium', 'low')),
  "status" text DEFAULT 'active' CHECK ("status" IN ('active', 'obsolete', 'draft', 'disabled')),
  "requirement_id" varchar(100),
  "file_path" varchar(500),
  "class_name" varchar(255),
  "method_name" varchar(255),
  "pass_rate" numeric(5,2) DEFAULT 0.00,
  "execution_count" integer DEFAULT 0,
  "last_execution_status" text CHECK ("last_execution_status" IN ('passed', 'failed', 'skipped', 'blocked')),
  "last_executed" timestamptz,
  "avg_duration_ms" integer DEFAULT 0,
  "flakiness_score" numeric(5,2) DEFAULT 0.00,
  "consecutive_failures" integer DEFAULT 0,
  "is_flaky" boolean DEFAULT false,
  "effectiveness_score" numeric(5,2) DEFAULT 0.00,
  "maintenance_cost_hours" numeric(10,2) DEFAULT 0.00,
  "created_by" varchar(36),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "avg_duration" numeric(8,2) DEFAULT 0.00 NOT NULL,
  CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_execution_runs" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "company_id" varchar(36) NOT NULL,
  "team_id" varchar(36),
  "test_suite" varchar(255) NOT NULL,
  "test_case_id" varchar(36),
  "status" text DEFAULT 'running' NOT NULL CHECK ("status" IN ('running', 'passed', 'failed', 'blocked', 'skipped')),
  "start_time" timestamptz DEFAULT now() NOT NULL,
  "end_time" timestamptz,
  "duration_seconds" integer DEFAULT 0,
  "assigned_to" varchar(36),
  "dependencies" jsonb,
  "error_message" text,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "test_execution_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "test_executions" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "test_case_id" varchar(36) NOT NULL,
  "team_id" varchar(36) NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('passed', 'failed', 'skipped', 'blocked')),
  "duration_ms" integer,
  "error_message" text,
  "stack_trace" text,
  "environment" varchar(50) DEFAULT 'staging',
  "build_number" varchar(100),
  "branch" varchar(255),
  "executed_by" varchar(36),
  "executed_at" timestamptz DEFAULT now(),
  CONSTRAINT "test_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" varchar(36) DEFAULT gen_random_uuid()::text NOT NULL,
  "email" varchar(255) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "first_name" varchar(100) NOT NULL,
  "last_name" varchar(100) NOT NULL,
  "role" text NOT NULL CHECK ("role" IN ('super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer')),
  "company_id" varchar(36) NOT NULL,
  "department_id" varchar(36) NOT NULL,
  "primary_team_id" varchar(36),
  "avatar_url" text,
  "phone" varchar(50),
  "timezone" varchar(50) DEFAULT 'UTC',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now(),
  "last_login" timestamptz,
  "is_active" boolean DEFAULT true,
  "email_verified" boolean DEFAULT false,
  "email_verified_at" timestamptz,
  "password_reset_token" varchar(255),
  "password_reset_expires" timestamptz,
  "failed_login_attempts" integer DEFAULT 0,
  "locked_until" timestamptz,
  "created_by" varchar(36),
  "developer_insights_enabled" boolean DEFAULT false,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_email" UNIQUE ("email")
);

-- Secondary indexes
CREATE INDEX "business_impact_business_kpis_idx_month" ON "business_impact_business_kpis" ("month_year");
CREATE INDEX "business_impact_business_kpis_idx_team" ON "business_impact_business_kpis" ("team_id");
CREATE INDEX "business_impact_config_idx_metric" ON "business_impact_config" ("metric_name");
CREATE INDEX "business_impact_config_idx_team" ON "business_impact_config" ("team_id");
CREATE INDEX "business_impact_context_idx_month" ON "business_impact_context" ("month_year");
CREATE INDEX "business_impact_context_idx_team" ON "business_impact_context" ("team_id");
CREATE INDEX "business_impact_correlations_idx_business_kpi" ON "business_impact_correlations" ("business_kpi");
CREATE INDEX "business_impact_correlations_idx_quality_metric" ON "business_impact_correlations" ("quality_metric");
CREATE INDEX "business_impact_correlations_idx_team" ON "business_impact_correlations" ("team_id");
CREATE INDEX "business_impact_data_status_idx_team" ON "business_impact_data_status" ("team_id");
CREATE INDEX "business_impact_history_idx_month" ON "business_impact_history" ("month_year");
CREATE INDEX "business_impact_history_idx_team" ON "business_impact_history" ("team_id");
CREATE INDEX "business_impact_metrics_idx_bim_company" ON "business_impact_metrics" ("company_id");
CREATE INDEX "business_impact_metrics_idx_bim_date" ON "business_impact_metrics" ("recorded_date");
CREATE INDEX "business_impact_quality_metrics_idx_month" ON "business_impact_quality_metrics" ("month_year");
CREATE INDEX "business_impact_quality_metrics_idx_team" ON "business_impact_quality_metrics" ("team_id");
CREATE INDEX "business_metrics_idx_business_metrics_company" ON "business_metrics" ("company_id", "metric_date");
CREATE INDEX "companies_idx_companies_domain" ON "companies" ("domain");
CREATE INDEX "configs_idx_configs_company" ON "configs" ("company_id");
CREATE INDEX "configs_idx_configs_department" ON "configs" ("department_id");
CREATE INDEX "configs_idx_configs_key" ON "configs" ("config_key");
CREATE INDEX "configs_idx_configs_team" ON "configs" ("team_id");
CREATE INDEX "departments_idx_departments_company" ON "departments" ("company_id");
CREATE INDEX "departments_idx_departments_manager" ON "departments" ("manager_id");
CREATE INDEX "developer_metrics_developer_id" ON "developer_metrics" ("developer_id");
CREATE INDEX "developer_productivity_snapshots_idx_developer_date" ON "developer_productivity_snapshots" ("developer_id", "snapshot_date");
CREATE INDEX "developer_productivity_snapshots_idx_snapshot_date" ON "developer_productivity_snapshots" ("snapshot_date");
CREATE INDEX "flaky_tests_idx_flaky_score" ON "flaky_tests" ("flakiness_score");
CREATE INDEX "flaky_tests_idx_flaky_team" ON "flaky_tests" ("team_id");
CREATE INDEX "kpi_snapshots_idx_kpi_snapshots_date" ON "kpi_snapshots" ("snapshot_date");
CREATE INDEX "kpi_snapshots_idx_kpi_snapshots_status" ON "kpi_snapshots" ("status");
CREATE INDEX "kpi_snapshots_idx_kpi_snapshots_team_date" ON "kpi_snapshots" ("team_id", "snapshot_date");
CREATE INDEX "metric_last_updated_idx_metric_last_updated_company" ON "metric_last_updated" ("company_id");
CREATE INDEX "metric_last_updated_idx_metric_last_updated_next" ON "metric_last_updated" ("next_update_at");
CREATE INDEX "performance_metrics_idx_perf_date" ON "performance_metrics" ("recorded_date");
CREATE INDEX "performance_metrics_idx_perf_endpoint" ON "performance_metrics" ("endpoint");
CREATE INDEX "performance_metrics_idx_perf_metrics_team" ON "performance_metrics" ("team_id");
CREATE INDEX "performance_metrics_idx_perf_team" ON "performance_metrics" ("team_id");
CREATE INDEX "pipeline_config_idx_pc_company" ON "pipeline_config" ("company_id");
CREATE INDEX "pipeline_execution_summary_idx_pes_company" ON "pipeline_execution_summary" ("company_id");
CREATE INDEX "pipeline_execution_summary_idx_pes_date" ON "pipeline_execution_summary" ("execution_date");
CREATE INDEX "pipeline_execution_summary_idx_pes_stage" ON "pipeline_execution_summary" ("stage_id");
CREATE INDEX "pipeline_runs_idx_run_company" ON "pipeline_runs" ("company_id");
CREATE INDEX "pipeline_runs_idx_run_stage" ON "pipeline_runs" ("stage_id");
CREATE INDEX "pipeline_runs_idx_run_started" ON "pipeline_runs" ("started_at");
CREATE INDEX "pipeline_stage_history_idx_psh_company" ON "pipeline_stage_history" ("company_id");
CREATE INDEX "pipeline_stage_history_idx_psh_recorded" ON "pipeline_stage_history" ("recorded_at");
CREATE INDEX "pipeline_stage_history_idx_psh_stage" ON "pipeline_stage_history" ("stage_id");
CREATE INDEX "pipeline_stages_idx_pipeline_company" ON "pipeline_stages" ("company_id");
CREATE INDEX "pipeline_stages_idx_pipeline_order" ON "pipeline_stages" ("stage_order");
CREATE INDEX "pipeline_stages_idx_pipeline_team" ON "pipeline_stages" ("team_id");
CREATE INDEX "seeder_runs_idx_seeder_company" ON "seeder_runs" ("company_id");
CREATE INDEX "seeder_runs_idx_seeder_name" ON "seeder_runs" ("seeder_name");
CREATE INDEX "seeder_runs_idx_seeder_run" ON "seeder_runs" ("last_run_at");
CREATE INDEX "sprint_velocity_idx_sprint_velocity_team" ON "sprint_velocity" ("team_id", "start_date");
CREATE INDEX "team_analytics_idx_period_type" ON "team_analytics" ("period_type");
CREATE INDEX "team_analytics_idx_team_period" ON "team_analytics" ("team_id", "period_start");
CREATE INDEX "team_members_idx_team_members_team" ON "team_members" ("team_id");
CREATE INDEX "team_members_idx_team_members_user" ON "team_members" ("user_id");
CREATE INDEX "team_pipeline_metrics_idx_team_date" ON "team_pipeline_metrics" ("team_id", "recorded_date");
CREATE INDEX "team_test_executions_idx_team_date" ON "team_test_executions" ("team_id", "execution_date");
CREATE INDEX "teams_idx_teams_company" ON "teams" ("company_id");
CREATE INDEX "teams_idx_teams_department" ON "teams" ("department_id");
CREATE INDEX "teams_idx_teams_lead" ON "teams" ("lead_id");
CREATE INDEX "technical_debt_idx_tech_debt_category" ON "technical_debt" ("category");
CREATE INDEX "technical_debt_idx_tech_debt_severity" ON "technical_debt" ("severity");
CREATE INDEX "technical_debt_idx_tech_debt_status" ON "technical_debt" ("status");
CREATE INDEX "technical_debt_idx_tech_debt_team" ON "technical_debt" ("team_id");
CREATE INDEX "test_case_tags_idx_test_tags_case" ON "test_case_tags" ("test_case_id");
CREATE INDEX "test_case_tags_idx_test_tags_tag" ON "test_case_tags" ("tag");
CREATE INDEX "test_cases_idx_test_cases_flaky" ON "test_cases" ("is_flaky");
CREATE INDEX "test_cases_idx_test_cases_requirement" ON "test_cases" ("requirement_id");
CREATE INDEX "test_cases_idx_test_cases_status" ON "test_cases" ("status");
CREATE INDEX "test_cases_idx_test_cases_team" ON "test_cases" ("team_id");
CREATE INDEX "test_cases_idx_test_cases_type" ON "test_cases" ("test_type");
CREATE INDEX "test_execution_runs_idx_ter_company" ON "test_execution_runs" ("company_id");
CREATE INDEX "test_execution_runs_idx_ter_start" ON "test_execution_runs" ("start_time");
CREATE INDEX "test_execution_runs_idx_ter_status" ON "test_execution_runs" ("status");
CREATE INDEX "test_executions_idx_test_exec_case" ON "test_executions" ("test_case_id");
CREATE INDEX "test_executions_idx_test_exec_date" ON "test_executions" ("executed_at");
CREATE INDEX "test_executions_idx_test_exec_status" ON "test_executions" ("status");
CREATE INDEX "test_executions_idx_test_exec_team" ON "test_executions" ("team_id");
CREATE INDEX "users_idx_users_company" ON "users" ("company_id");
CREATE INDEX "users_idx_users_department" ON "users" ("department_id");
CREATE INDEX "users_idx_users_email" ON "users" ("email");
CREATE INDEX "users_idx_users_primary_team" ON "users" ("primary_team_id");
CREATE INDEX "users_idx_users_role" ON "users" ("role");

-- MySQL compared emails case-insensitively (utf8mb4_unicode_ci); keep that guarantee
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));

-- Foreign keys
ALTER TABLE "business_impact_business_kpis" ADD CONSTRAINT "business_impact_business_kpis_fk_business_kpis_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_config" ADD CONSTRAINT "business_impact_config_fk_business_impact_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_context" ADD CONSTRAINT "business_impact_context_fk_context_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_correlations" ADD CONSTRAINT "business_impact_correlations_fk_correlations_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_data_status" ADD CONSTRAINT "business_impact_data_status_fk_status_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_history" ADD CONSTRAINT "business_impact_history_fk_business_impact_history_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_metrics" ADD CONSTRAINT "business_impact_metrics_fk_bim_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_impact_quality_metrics" ADD CONSTRAINT "business_impact_quality_metrics_fk_quality_metrics_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "business_metrics" ADD CONSTRAINT "business_metrics_business_metrics_ibfk_1" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "configs" ADD CONSTRAINT "configs_fk_configs_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "configs" ADD CONSTRAINT "configs_fk_configs_department" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "configs" ADD CONSTRAINT "configs_fk_configs_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_departments_ibfk_1" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_departments_ibfk_2" FOREIGN KEY ("manager_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
ALTER TABLE "departments" ADD CONSTRAINT "departments_departments_ibfk_3" FOREIGN KEY ("manager_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
ALTER TABLE "developer_metrics" ADD CONSTRAINT "developer_metrics_developer_metrics_ibfk_1" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "developer_metrics" ADD CONSTRAINT "developer_metrics_developer_metrics_ibfk_2" FOREIGN KEY ("developer_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "developer_productivity_snapshots" ADD CONSTRAINT "developer_productivity_snapshots_developer_productivity_snapsho" FOREIGN KEY ("developer_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "flaky_tests" ADD CONSTRAINT "flaky_tests_fk_flaky_case" FOREIGN KEY ("test_case_id") REFERENCES "test_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "flaky_tests" ADD CONSTRAINT "flaky_tests_fk_flaky_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_kpi_snapshots_ibfk_1" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "metric_last_updated" ADD CONSTRAINT "metric_last_updated_fk_metric_last_updated_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "metric_last_updated" ADD CONSTRAINT "metric_last_updated_fk_metric_last_updated_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "metric_update_intervals" ADD CONSTRAINT "metric_update_intervals_fk_metric_update_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "performance_metrics" ADD CONSTRAINT "performance_metrics_fk_perf_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_execution_summary" ADD CONSTRAINT "pipeline_execution_summary_fk_pes_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_execution_summary" ADD CONSTRAINT "pipeline_execution_summary_fk_pes_stage" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_fk_run_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_fk_run_stage" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_fk_psh_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_stage_history" ADD CONSTRAINT "pipeline_stage_history_fk_psh_stage" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_fk_pipeline_company" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_fk_pipeline_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
ALTER TABLE "sprint_velocity" ADD CONSTRAINT "sprint_velocity_sprint_velocity_ibfk_1" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "team_analytics" ADD CONSTRAINT "team_analytics_fk_team_analytics_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_members_ibfk_1" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_members_ibfk_2" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "team_pipeline_metrics" ADD CONSTRAINT "team_pipeline_metrics_fk_team_pipeline_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "team_test_executions" ADD CONSTRAINT "team_test_executions_fk_team_test_exec_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_teams_ibfk_1" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_teams_ibfk_2" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_teams_ibfk_3" FOREIGN KEY ("lead_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
ALTER TABLE "technical_debt" ADD CONSTRAINT "technical_debt_fk_tech_debt_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "test_case_tags" ADD CONSTRAINT "test_case_tags_fk_test_tags_case" FOREIGN KEY ("test_case_id") REFERENCES "test_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_fk_test_cases_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_fk_test_exec_case" FOREIGN KEY ("test_case_id") REFERENCES "test_cases" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "test_executions" ADD CONSTRAINT "test_executions_fk_test_exec_team" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_users_ibfk_1" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_users_ibfk_2" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON UPDATE NO ACTION ON DELETE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_users_ibfk_3" FOREIGN KEY ("primary_team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_users_ibfk_4" FOREIGN KEY ("primary_team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE SET NULL;

-- updated_at triggers
CREATE TRIGGER "business_impact_business_kpis_set_updated_at" BEFORE UPDATE ON "business_impact_business_kpis" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_config_set_updated_at" BEFORE UPDATE ON "business_impact_config" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_context_set_updated_at" BEFORE UPDATE ON "business_impact_context" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_correlations_set_updated_at" BEFORE UPDATE ON "business_impact_correlations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_data_status_set_updated_at" BEFORE UPDATE ON "business_impact_data_status" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_history_set_updated_at" BEFORE UPDATE ON "business_impact_history" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "business_impact_quality_metrics_set_updated_at" BEFORE UPDATE ON "business_impact_quality_metrics" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "companies_set_updated_at" BEFORE UPDATE ON "companies" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "configs_set_updated_at" BEFORE UPDATE ON "configs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "departments_set_updated_at" BEFORE UPDATE ON "departments" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "developer_metrics_set_updated_at" BEFORE UPDATE ON "developer_metrics" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "flaky_tests_set_updated_at" BEFORE UPDATE ON "flaky_tests" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "metric_update_intervals_set_updated_at" BEFORE UPDATE ON "metric_update_intervals" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "pipeline_config_set_updated_at" BEFORE UPDATE ON "pipeline_config" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "pipeline_execution_summary_set_updated_at" BEFORE UPDATE ON "pipeline_execution_summary" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "pipeline_stages_set_updated_at" BEFORE UPDATE ON "pipeline_stages" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "team_analytics_set_updated_at" BEFORE UPDATE ON "team_analytics" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "teams_set_updated_at" BEFORE UPDATE ON "teams" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "technical_debt_set_updated_at" BEFORE UPDATE ON "technical_debt" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "test_cases_set_updated_at" BEFORE UPDATE ON "test_cases" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The app connects directly as the database owner, never through Supabase's Data API.
-- Enabling RLS with no policies keeps these tables (incl. password hashes) unreachable via the anon/authenticated keys.
ALTER TABLE "business_impact_business_kpis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_context" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_correlations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_data_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_impact_quality_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_kpi_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "developer_productivity_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flaky_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kpi_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_last_updated" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metric_update_intervals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_execution_summary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seeder_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sprint_velocity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_analytics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_pipeline_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_test_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "technical_debt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_case_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_execution_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "test_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
