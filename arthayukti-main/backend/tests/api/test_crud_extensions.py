from decimal import Decimal

from tests.api.test_api import sample_plan
from tests.helpers import authed_client


def test_plan_delete_and_isolation():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    # Alice creates a plan
    plan_payload = sample_plan()
    r = c1.post("/api/v1/plans", json=plan_payload)
    assert r.status_code == 201
    plan_id = r.json()["id"]

    # Bob cannot delete Alice's plan
    r = c2.delete(f"/api/v1/plans/{plan_id}")
    assert r.status_code == 404

    # Alice can delete her plan
    r = c1.delete(f"/api/v1/plans/{plan_id}")
    assert r.status_code == 204

    # Now it is gone
    r = c1.get(f"/api/v1/plans/{plan_id}")
    assert r.status_code == 404


def test_account_crud_and_isolation():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    # Create
    acc_payload = {
        "account_name": "Emergency Fund",
        "account_type": "savings",
        "balance": "250000.00",
        "currency": "INR",
        "is_liquid": True,
        "institution_name": "HDFC Bank",
    }
    r = c1.post("/api/v1/financials/accounts", json=acc_payload)
    assert r.status_code == 201
    acc_id = r.json()["id"]

    # Get single
    r = c1.get(f"/api/v1/financials/accounts/{acc_id}")
    assert r.status_code == 200
    assert r.json()["account_name"] == "Emergency Fund"

    # Bob cannot view Alice's account
    r = c2.get(f"/api/v1/financials/accounts/{acc_id}")
    assert r.status_code == 404

    # Update
    r = c1.put(
        f"/api/v1/financials/accounts/{acc_id}",
        json={"balance": "300000.00", "account_name": "Emergency Fund Updated"},
    )
    assert r.status_code == 200
    assert r.json()["balance"] == "300000.00"
    assert r.json()["account_name"] == "Emergency Fund Updated"

    # Bob cannot update Alice's account
    r = c2.put(
        f"/api/v1/financials/accounts/{acc_id}",
        json={"balance": "0.00"},
    )
    assert r.status_code == 404

    # Delete
    r = c1.delete(f"/api/v1/financials/accounts/{acc_id}")
    assert r.status_code == 204

    # Verify deleted
    r = c1.get(f"/api/v1/financials/accounts/{acc_id}")
    assert r.status_code == 404


def test_investment_crud_and_isolation():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    inv_payload = {
        "asset_name": "Nifty 50 Index Fund",
        "asset_type": "mutual_fund",
        "symbol": "NIFTY50",
        "quantity": "500.0000",
        "purchase_price": "100000.00",
        "current_value": "125000.00",
        "is_liquid": True,
    }
    r = c1.post("/api/v1/financials/investments", json=inv_payload)
    assert r.status_code == 201
    inv_id = r.json()["id"]

    # Get single
    r = c1.get(f"/api/v1/financials/investments/{inv_id}")
    assert r.status_code == 200
    assert r.json()["current_value"] == "125000.00"

    # Bob cannot get or edit
    assert c2.get(f"/api/v1/financials/investments/{inv_id}").status_code == 404
    assert (
        c2.put(f"/api/v1/financials/investments/{inv_id}", json={"current_value": "1.00"}).status_code
        == 404
    )

    # Alice updates
    r = c1.put(
        f"/api/v1/financials/investments/{inv_id}",
        json={"current_value": "130000.00"},
    )
    assert r.status_code == 200
    assert r.json()["current_value"] == "130000.00"

    # Alice deletes
    assert c1.delete(f"/api/v1/financials/investments/{inv_id}").status_code == 204
    assert c1.get(f"/api/v1/financials/investments/{inv_id}").status_code == 404


def test_liability_crud_and_isolation():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    liab_payload = {
        "liability_name": "Car Loan",
        "liability_type": "auto_loan",
        "principal_amount": "600000.00",
        "current_balance": "450000.00",
        "interest_rate": "0.0875",
        "monthly_emi": "14500.00",
        "remaining_months": 36,
    }
    r = c1.post("/api/v1/financials/liabilities", json=liab_payload)
    assert r.status_code == 201
    liab_id = r.json()["id"]

    # Get single
    r = c1.get(f"/api/v1/financials/liabilities/{liab_id}")
    assert r.status_code == 200
    assert r.json()["liability_name"] == "Car Loan"

    # Bob cannot view or delete
    assert c2.get(f"/api/v1/financials/liabilities/{liab_id}").status_code == 404
    assert c2.delete(f"/api/v1/financials/liabilities/{liab_id}").status_code == 404

    # Alice updates balance
    r = c1.put(
        f"/api/v1/financials/liabilities/{liab_id}",
        json={"current_balance": "435500.00", "remaining_months": 35},
    )
    assert r.status_code == 200
    assert r.json()["current_balance"] == "435500.00"
    assert r.json()["remaining_months"] == 35

    # Alice deletes
    assert c1.delete(f"/api/v1/financials/liabilities/{liab_id}").status_code == 204
    assert c1.get(f"/api/v1/financials/liabilities/{liab_id}").status_code == 404


def test_transaction_delete_and_balance_reversal():
    c = authed_client("alice")

    # Create account with 10,000 balance
    acc_r = c.post(
        "/api/v1/financials/accounts",
        json={
            "account_name": "Checking Account",
            "account_type": "checking",
            "balance": "10000.00",
        },
    )
    acc_id = acc_r.json()["id"]

    # Create debit transaction of 2,000 (account balance becomes 8,000)
    tx_r = c.post(
        "/api/v1/financials/transactions",
        json={
            "account_id": acc_id,
            "transaction_date": "2026-03-15",
            "amount": "2000.00",
            "transaction_type": "debit",
            "category": "Groceries",
        },
    )
    assert tx_r.status_code == 201
    tx_id = tx_r.json()["id"]

    # Verify account balance reduced
    acc_after = c.get(f"/api/v1/financials/accounts/{acc_id}").json()
    assert Decimal(acc_after["balance"]) == Decimal("8000.00")

    # Delete transaction
    del_r = c.delete(f"/api/v1/financials/transactions/{tx_id}")
    assert del_r.status_code == 204

    # Verify balance was reversed back to 10,000
    acc_restored = c.get(f"/api/v1/financials/accounts/{acc_id}").json()
    assert Decimal(acc_restored["balance"]) == Decimal("10000.00")


def test_account_transfers():
    c = authed_client("alice")

    acc1 = c.post(
        "/api/v1/financials/accounts",
        json={"account_name": "Savings A", "account_type": "savings", "balance": "50000.00"},
    ).json()["id"]

    acc2 = c.post(
        "/api/v1/financials/accounts",
        json={"account_name": "Savings B", "account_type": "savings", "balance": "10000.00"},
    ).json()["id"]

    # Transfer 15,000 from acc1 to acc2
    transfer_payload = {
        "from_account_id": acc1,
        "to_account_id": acc2,
        "amount": "15000.00",
        "transaction_date": "2026-04-01",
        "description": "Monthly savings allocation",
    }
    r = c.post("/api/v1/financials/transfers", json=transfer_payload)
    assert r.status_code == 201
    res = r.json()
    assert res["from_transaction"]["amount"] == "15000.00"
    assert res["from_transaction"]["transaction_type"] == "debit"
    assert res["to_transaction"]["amount"] == "15000.00"
    assert res["to_transaction"]["transaction_type"] == "credit"

    # Check updated balances
    b1 = Decimal(c.get(f"/api/v1/financials/accounts/{acc1}").json()["balance"])
    b2 = Decimal(c.get(f"/api/v1/financials/accounts/{acc2}").json()["balance"])
    assert b1 == Decimal("35000.00")
    assert b2 == Decimal("25000.00")

    # Reject transfer to same account
    bad_r = c.post(
        "/api/v1/financials/transfers",
        json={
            "from_account_id": acc1,
            "to_account_id": acc1,
            "amount": "1000.00",
            "transaction_date": "2026-04-01",
        },
    )
    assert bad_r.status_code == 400


def test_insurance_policy_delete():
    c1 = authed_client("alice")
    c2 = authed_client("bob")

    policy_payload = {
        "policy_number": "POL-987654",
        "policy_type": "term_life",
        "insurer_name": "HDFC Life",
        "plan_name": "Click 2 Protect 3D Plus",
        "start_date": "2024-01-01",
        "base_sum_assured": "10000000.00",
        "premium_amount": "15000.00",
        "premium_frequency": "annual",
        "status": "active",
    }
    r = c1.post("/api/v1/insurance/policies", json=policy_payload)
    assert r.status_code == 201
    pol_id = r.json()["id"]

    # Bob cannot delete
    assert c2.delete(f"/api/v1/insurance/policies/{pol_id}").status_code == 404

    # Alice deletes
    assert c1.delete(f"/api/v1/insurance/policies/{pol_id}").status_code == 204
    assert c1.get(f"/api/v1/insurance/policies/{pol_id}").status_code == 404
