"""profile_and_risk_assessments
 
Revision ID: c2d3e4f5a6b7
Revises: b1a2c3d4e5f6
Create Date: 2026-10-25 02:00:00.000000
 
Adds extended personal, family, resilience, and retirement fields to household_profiles,
phone_number to users, and creates the risk_assessments table.
"""
 
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2d3e4f5a6b7"
down_revision: str | Sequence[str] | None = "b1a2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None
 
 
def upgrade() -> None:
    # 1. Add phone_number to users
    op.add_column("users", sa.Column("phone_number", sa.String(length=50), nullable=True))
 
    # 2. Add extended fields to household_profiles
    op.add_column("household_profiles", sa.Column("marital_status", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("has_children", sa.Boolean(), nullable=True))
    op.add_column("household_profiles", sa.Column("children_ages_json", sa.Text(), nullable=True))
    op.add_column("household_profiles", sa.Column("supports_mother", sa.String(length=20), nullable=True))
    op.add_column("household_profiles", sa.Column("supports_father", sa.String(length=20), nullable=True))
    op.add_column("household_profiles", sa.Column("housing_status", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("employment_status", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("expected_retirement_age", sa.Integer(), nullable=True))
    op.add_column("household_profiles", sa.Column("financial_dependants", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("debt_types_json", sa.Text(), nullable=True))
    op.add_column("household_profiles", sa.Column("emergency_fund_coverage", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("income_predictability", sa.String(length=50), nullable=True))
    op.add_column("household_profiles", sa.Column("health_insurance_status", sa.String(length=20), nullable=True))
    op.add_column("household_profiles", sa.Column("life_insurance_status", sa.String(length=20), nullable=True))
 
    # 3. Create risk_assessments table
    op.create_table(
        "risk_assessments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("scoring_version", sa.String(length=20), nullable=False),
        sa.Column("loss_reaction", sa.String(length=50), nullable=False),
        sa.Column("safety_growth", sa.String(length=50), nullable=False),
        sa.Column("time_horizon", sa.String(length=50), nullable=False),
        sa.Column("answers_json", sa.Text(), nullable=False),
        sa.Column("tolerance_score", sa.Integer(), nullable=False),
        sa.Column("risk_tolerance", sa.String(length=50), nullable=False),
        sa.Column("risk_capacity", sa.String(length=50), nullable=False),
        sa.Column("composite_stance", sa.String(length=50), nullable=False),
        sa.Column("explanations_json", sa.Text(), nullable=False),
        sa.Column("conflict_note", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_risk_assessments_user_id"),
        "risk_assessments",
        ["user_id"],
        unique=False,
    )
 
 
def downgrade() -> None:
    op.drop_index(op.f("ix_risk_assessments_user_id"), table_name="risk_assessments")
    op.drop_table("risk_assessments")
    op.drop_column("household_profiles", "life_insurance_status")
    op.drop_column("household_profiles", "health_insurance_status")
    op.drop_column("household_profiles", "income_predictability")
    op.drop_column("household_profiles", "emergency_fund_coverage")
    op.drop_column("household_profiles", "debt_types_json")
    op.drop_column("household_profiles", "financial_dependants")
    op.drop_column("household_profiles", "expected_retirement_age")
    op.drop_column("household_profiles", "employment_status")
    op.drop_column("household_profiles", "housing_status")
    op.drop_column("household_profiles", "supports_father")
    op.drop_column("household_profiles", "supports_mother")
    op.drop_column("household_profiles", "children_ages_json")
    op.drop_column("household_profiles", "has_children")
    op.drop_column("household_profiles", "marital_status")
    op.drop_column("users", "phone_number")
