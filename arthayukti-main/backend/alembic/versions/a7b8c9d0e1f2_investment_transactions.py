"""investment_transactions

Revision ID: a7b8c9d0e1f2
Revises: f5a6b7c8d9e0
Create Date: 2026-10-27 10:00:00.000000

Adds the holdings ledger: actual, past transactions (buy, sale, split, bonus, dividend) on a holding. A new table only:
no existing table or row changes, and a holding with no transactions behaves exactly as before.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a7b8c9d0e1f2"
down_revision: str | Sequence[str] | None = "f5a6b7c8d9e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "investment_transactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("holding_id", sa.String(length=36), nullable=False),
        sa.Column("transaction_type", sa.String(length=20), nullable=False),
        sa.Column("trade_date", sa.String(length=10), nullable=False),
        sa.Column("quantity", sa.Numeric(24, 6), nullable=True),
        sa.Column("price", sa.Numeric(24, 4), nullable=True),
        sa.Column("fees", sa.Numeric(20, 2), nullable=False),
        sa.Column("ratio_new", sa.Integer(), nullable=True),
        sa.Column("ratio_old", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["holding_id"], ["assets_investments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_investment_transactions_user_id", "investment_transactions", ["user_id"])
    op.create_index("ix_investment_transactions_holding_id", "investment_transactions", ["holding_id"])


def downgrade() -> None:
    op.drop_index("ix_investment_transactions_holding_id", table_name="investment_transactions")
    op.drop_index("ix_investment_transactions_user_id", table_name="investment_transactions")
    op.drop_table("investment_transactions")
