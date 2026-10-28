import io
from decimal import Decimal

from tests.helpers import authed_client

client = authed_client()


def test_financial_accounts_and_transactions():
    # 1. Create account
    acc = client.post(
        "/api/v1/financials/accounts",
        json={
            "account_name": "Emergency Bank Account",
            "account_type": "savings",
            "balance": "200000.00",
            "is_liquid": True,
        },
    ).json()
    acc_id = acc["id"]
    assert acc["balance"] == "200000.00"

    # 2. Add credit transaction
    client.post(
        "/api/v1/financials/transactions",
        json={
            "account_id": acc_id,
            "transaction_date": "2026-10-24",
            "amount": "50000.00",
            "transaction_type": "credit",
            "category": "Salary",
            "description": "Monthly Salary",
            "is_essential": True,
        },
    )

    # 3. Add debit transaction
    client.post(
        "/api/v1/financials/transactions",
        json={
            "account_id": acc_id,
            "transaction_date": "2026-10-25",
            "amount": "15000.00",
            "transaction_type": "debit",
            "category": "Groceries",
            "description": "Supermarket",
            "is_essential": True,
        },
    )

    # Balance should now be 2,00,000 + 50,000 - 15,000 = 2,35,000.00
    accounts = client.get("/api/v1/financials/accounts").json()
    updated_acc = next(a for a in accounts if a["id"] == acc_id)
    assert updated_acc["balance"] == "235000.00"


def test_csv_import_exact_decimal_precision():
    """Verify that CSV import handles exact decimal numbers without floating point errors."""
    csv_data = (
        "date,amount,type,category,description,is_essential\n"
        "2026-10-01,12500.50,debit,School Tuition,Q4 Fees,true\n"
        "2026-10-02,450.25,debit,Pharmacy,Medicine,true\n"
        "2026-10-05,80000.00,credit,Freelance,Consulting,false\n"
    )
    files = {"file": ("transactions.csv", io.BytesIO(csv_data.encode("utf-8")), "text/csv")}
    res = client.post("/api/v1/financials/transactions/import", files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["imported_count"] == 3
    assert body["failed_count"] == 0


def test_net_worth_calculation():
    """Verify Net Worth endpoint correctly aggregates liquid, illiquid, and liabilities."""
    res = client.get("/api/v1/financials/net-worth")
    assert res.status_code == 200
    body = res.json()
    assert "total_assets" in body
    assert "liquid_assets" in body
    assert "illiquid_assets" in body
    assert "total_liabilities" in body
    assert "net_worth" in body

    total_assets = Decimal(body["total_assets"])
    liquid = Decimal(body["liquid_assets"])
    illiquid = Decimal(body["illiquid_assets"])
    liabs = Decimal(body["total_liabilities"])
    net_worth = Decimal(body["net_worth"])

    assert total_assets == liquid + illiquid
    assert net_worth == total_assets - liabs
