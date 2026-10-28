"""portfolio_snapshots

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-10-28 10:00:00.000000

Adds dated readings of a person's stock portfolio value, so a value history can be built going forward (the price
provider has no historical prices). A new table only: no existing table or row changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "portfolio_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_date", sa.String(length=10), nullable=False),
        sa.Column("market_value", sa.Numeric(20, 2), nullable=False),
        sa.Column("invested", sa.Numeric(20, 2), nullable=False),
        sa.Column("priced_count", sa.Integer(), nullable=False),
        sa.Column("holding_count", sa.Integer(), nullable=False),
        sa.Column("complete", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "snapshot_date", name="uq_portfolio_snapshot_user_date"),
    )
    op.create_index("ix_portfolio_snapshots_user_id", "portfolio_snapshots", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_portfolio_snapshots_user_id", table_name="portfolio_snapshots")
    op.drop_table("portfolio_snapshots")
