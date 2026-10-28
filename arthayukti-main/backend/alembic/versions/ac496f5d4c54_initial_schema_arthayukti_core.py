"""initial_schema_arthayukti_core

Revision ID: ac496f5d4c54
Revises:
Create Date: 2026-10-24 20:02:38.319862

The full schema, generated against an empty database. Before this revision the file was empty and
the tables came from SQLAlchemy create_all at import time, which Alembic could not track.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ac496f5d4c54"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the full ArthaYukti schema."""
    op.create_table(
        "market_data_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("symbol", sa.String(length=50), nullable=False),
        sa.Column("asset_type", sa.String(length=50), nullable=False),
        sa.Column("price", sa.Numeric(precision=20, scale=4), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_stale", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_market_data_snapshots_symbol"), "market_data_snapshots", ["symbol"], unique=False
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_table(
        "assets_investments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("asset_name", sa.String(length=255), nullable=False),
        sa.Column("asset_type", sa.String(length=50), nullable=False),
        sa.Column("symbol", sa.String(length=50), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=20, scale=4), nullable=False),
        sa.Column("purchase_price", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("current_value", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("is_liquid", sa.Boolean(), nullable=False),
        sa.Column("last_valuation_date", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_assets_investments_symbol"), "assets_investments", ["symbol"], unique=False
    )
    op.create_index(
        op.f("ix_assets_investments_user_id"), "assets_investments", ["user_id"], unique=False
    )
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("resource_type", sa.String(length=100), nullable=False),
        sa.Column("resource_id", sa.String(length=100), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"], unique=False)
    op.create_index(op.f("ix_audit_logs_user_id"), "audit_logs", ["user_id"], unique=False)
    op.create_table(
        "financial_accounts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("account_name", sa.String(length=255), nullable=False),
        sa.Column("account_type", sa.String(length=50), nullable=False),
        sa.Column("balance", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("is_liquid", sa.Boolean(), nullable=False),
        sa.Column("institution_name", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_financial_accounts_user_id"), "financial_accounts", ["user_id"], unique=False
    )
    op.create_table(
        "insurance_policies",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("policy_number", sa.String(length=100), nullable=False),
        sa.Column("policy_type", sa.String(length=50), nullable=False),
        sa.Column("insurer_name", sa.String(length=255), nullable=False),
        sa.Column("plan_name", sa.String(length=255), nullable=False),
        sa.Column("start_date", sa.String(length=10), nullable=False),
        sa.Column("renewal_date", sa.String(length=10), nullable=True),
        sa.Column("expiry_date", sa.String(length=10), nullable=True),
        sa.Column("base_sum_assured", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column(
            "current_effective_sum_assured", sa.Numeric(precision=20, scale=2), nullable=False
        ),
        sa.Column("premium_amount", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("premium_frequency", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("policy_details_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_insurance_policies_policy_number"),
        "insurance_policies",
        ["policy_number"],
        unique=False,
    )
    op.create_index(
        op.f("ix_insurance_policies_user_id"), "insurance_policies", ["user_id"], unique=False
    )
    op.create_table(
        "liabilities",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("liability_name", sa.String(length=255), nullable=False),
        sa.Column("liability_type", sa.String(length=50), nullable=False),
        sa.Column("principal_amount", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("current_balance", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("interest_rate", sa.Numeric(precision=9, scale=6), nullable=False),
        sa.Column("monthly_emi", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("start_date", sa.String(length=10), nullable=True),
        sa.Column("end_date", sa.String(length=10), nullable=True),
        sa.Column("remaining_months", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_liabilities_user_id"), "liabilities", ["user_id"], unique=False)
    op.create_table(
        "password_resets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_password_resets_token_hash"), "password_resets", ["token_hash"], unique=True
    )
    op.create_index(
        op.f("ix_password_resets_user_id"), "password_resets", ["user_id"], unique=False
    )
    op.create_table(
        "saved_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("as_of", sa.String(length=7), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False),
        sa.Column("plan_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_saved_plans_user_id"), "saved_plans", ["user_id"], unique=False)
    op.create_table(
        "calculation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=True),
        sa.Column("run_type", sa.String(length=50), nullable=False),
        sa.Column("inputs_hash", sa.String(length=64), nullable=False),
        sa.Column("summary_json", sa.Text(), nullable=False),
        sa.Column("assumptions_json", sa.Text(), nullable=False),
        sa.Column("model_version", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["saved_plans.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_calculation_runs_inputs_hash"), "calculation_runs", ["inputs_hash"], unique=False
    )
    op.create_index(
        op.f("ix_calculation_runs_plan_id"), "calculation_runs", ["plan_id"], unique=False
    )
    op.create_index(
        op.f("ix_calculation_runs_user_id"), "calculation_runs", ["user_id"], unique=False
    )
    op.create_table(
        "coverage_escalations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("policy_id", sa.String(length=36), nullable=False),
        sa.Column("escalation_type", sa.String(length=50), nullable=False),
        sa.Column("base_sum_assured", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column(
            "current_effective_sum_assured", sa.Numeric(precision=20, scale=2), nullable=False
        ),
        sa.Column("escalation_rate", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("fixed_escalation_amount", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("escalation_frequency", sa.String(length=50), nullable=False),
        sa.Column("custom_interval_months", sa.Integer(), nullable=True),
        sa.Column("first_escalation_date", sa.String(length=10), nullable=True),
        sa.Column("next_escalation_date", sa.String(length=10), nullable=True),
        sa.Column("maximum_total_cover", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("maximum_increase_percentage", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("maximum_cover_multiple", sa.Numeric(precision=12, scale=6), nullable=True),
        sa.Column("premium_increases_with_cover", sa.Boolean(), nullable=False),
        sa.Column("premium_change_rule", sa.Text(), nullable=True),
        sa.Column("medical_underwriting_required", sa.Boolean(), nullable=False),
        sa.Column("age_limit", sa.Integer(), nullable=True),
        sa.Column("escalation_status", sa.String(length=20), nullable=False),
        sa.Column("escalation_terms", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["policy_id"], ["insurance_policies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_coverage_escalations_next_escalation_date"),
        "coverage_escalations",
        ["next_escalation_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_escalations_policy_id"),
        "coverage_escalations",
        ["policy_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_escalations_user_id"), "coverage_escalations", ["user_id"], unique=False
    )
    op.create_table(
        "financial_transactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("transaction_date", sa.String(length=10), nullable=False),
        sa.Column("amount", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("transaction_type", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("is_essential", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_financial_transactions_account_id"),
        "financial_transactions",
        ["account_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_financial_transactions_category"),
        "financial_transactions",
        ["category"],
        unique=False,
    )
    op.create_index(
        op.f("ix_financial_transactions_transaction_date"),
        "financial_transactions",
        ["transaction_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_financial_transactions_user_id"),
        "financial_transactions",
        ["user_id"],
        unique=False,
    )
    op.create_table(
        "insurance_reminders",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("policy_id", sa.String(length=36), nullable=False),
        sa.Column("reminder_type", sa.String(length=50), nullable=False),
        sa.Column("due_date", sa.String(length=10), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("is_acknowledged", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["policy_id"], ["insurance_policies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_insurance_reminders_due_date"), "insurance_reminders", ["due_date"], unique=False
    )
    op.create_index(
        op.f("ix_insurance_reminders_policy_id"), "insurance_reminders", ["policy_id"], unique=False
    )
    op.create_index(
        op.f("ix_insurance_reminders_user_id"), "insurance_reminders", ["user_id"], unique=False
    )
    op.create_table(
        "coverage_escalation_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("escalation_id", sa.String(length=36), nullable=False),
        sa.Column("policy_id", sa.String(length=36), nullable=False),
        sa.Column("effective_date", sa.String(length=10), nullable=False),
        sa.Column("event_type", sa.String(length=50), nullable=False),
        sa.Column("prior_cover", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("increase_amount", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("resulting_cover", sa.Numeric(precision=20, scale=2), nullable=False),
        sa.Column("premium_before", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("premium_after", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("underwriting_requirement", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("supporting_document", sa.String(length=255), nullable=True),
        sa.Column("calculation_version", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["escalation_id"], ["coverage_escalations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["policy_id"], ["insurance_policies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "escalation_id", "idempotency_key", name="uq_escalation_idempotency_key"
        ),
    )
    op.create_index(
        op.f("ix_coverage_escalation_history_escalation_id"),
        "coverage_escalation_history",
        ["escalation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_escalation_history_idempotency_key"),
        "coverage_escalation_history",
        ["idempotency_key"],
        unique=False,
    )
    op.create_index(
        op.f("ix_coverage_escalation_history_policy_id"),
        "coverage_escalation_history",
        ["policy_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop everything this revision created."""
    op.drop_index(
        op.f("ix_coverage_escalation_history_policy_id"), table_name="coverage_escalation_history"
    )
    op.drop_index(
        op.f("ix_coverage_escalation_history_idempotency_key"),
        table_name="coverage_escalation_history",
    )
    op.drop_index(
        op.f("ix_coverage_escalation_history_escalation_id"),
        table_name="coverage_escalation_history",
    )
    op.drop_table("coverage_escalation_history")
    op.drop_index(op.f("ix_insurance_reminders_user_id"), table_name="insurance_reminders")
    op.drop_index(op.f("ix_insurance_reminders_policy_id"), table_name="insurance_reminders")
    op.drop_index(op.f("ix_insurance_reminders_due_date"), table_name="insurance_reminders")
    op.drop_table("insurance_reminders")
    op.drop_index(op.f("ix_financial_transactions_user_id"), table_name="financial_transactions")
    op.drop_index(
        op.f("ix_financial_transactions_transaction_date"), table_name="financial_transactions"
    )
    op.drop_index(op.f("ix_financial_transactions_category"), table_name="financial_transactions")
    op.drop_index(op.f("ix_financial_transactions_account_id"), table_name="financial_transactions")
    op.drop_table("financial_transactions")
    op.drop_index(op.f("ix_coverage_escalations_user_id"), table_name="coverage_escalations")
    op.drop_index(op.f("ix_coverage_escalations_policy_id"), table_name="coverage_escalations")
    op.drop_index(
        op.f("ix_coverage_escalations_next_escalation_date"), table_name="coverage_escalations"
    )
    op.drop_table("coverage_escalations")
    op.drop_index(op.f("ix_calculation_runs_user_id"), table_name="calculation_runs")
    op.drop_index(op.f("ix_calculation_runs_plan_id"), table_name="calculation_runs")
    op.drop_index(op.f("ix_calculation_runs_inputs_hash"), table_name="calculation_runs")
    op.drop_table("calculation_runs")
    op.drop_index(op.f("ix_saved_plans_user_id"), table_name="saved_plans")
    op.drop_table("saved_plans")
    op.drop_index(op.f("ix_password_resets_user_id"), table_name="password_resets")
    op.drop_index(op.f("ix_password_resets_token_hash"), table_name="password_resets")
    op.drop_table("password_resets")
    op.drop_index(op.f("ix_liabilities_user_id"), table_name="liabilities")
    op.drop_table("liabilities")
    op.drop_index(op.f("ix_insurance_policies_user_id"), table_name="insurance_policies")
    op.drop_index(op.f("ix_insurance_policies_policy_number"), table_name="insurance_policies")
    op.drop_table("insurance_policies")
    op.drop_index(op.f("ix_financial_accounts_user_id"), table_name="financial_accounts")
    op.drop_table("financial_accounts")
    op.drop_index(op.f("ix_audit_logs_user_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action"), table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index(op.f("ix_assets_investments_user_id"), table_name="assets_investments")
    op.drop_index(op.f("ix_assets_investments_symbol"), table_name="assets_investments")
    op.drop_table("assets_investments")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
    op.drop_index(op.f("ix_market_data_snapshots_symbol"), table_name="market_data_snapshots")
    op.drop_table("market_data_snapshots")
