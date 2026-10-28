from tests.helpers import authed_client


def test_export_covers_everything_the_settings_page_promises_and_only_the_owners():
    alice = authed_client("export_a")
    bob = authed_client("export_b")
    plan = alice.get("/api/v1/samples/tiny_delayed_goal").json()["plan"]
    assert alice.post("/api/v1/plans", json=plan).status_code == 201
    acct = alice.post("/api/v1/financials/accounts", json={"account_name": "Savings", "account_type": "savings", "balance": "1000.00"}).json()
    alice.post("/api/v1/financials/transactions", json={"transaction_date": "2027-01-05", "amount": "250.00", "transaction_type": "debit", "category": "Groceries", "account_id": acct["id"]})
    alice.post("/api/v1/financials/investments", json={"asset_name": "Index fund", "asset_type": "mutual_fund", "current_value": "5000.00", "purchase_price": "4000.00", "quantity": "1", "is_liquid": True})
    alice.post("/api/v1/financials/liabilities", json={"liability_name": "Car loan", "liability_type": "auto_loan", "principal_amount": "9000.00", "current_balance": "8000.00", "interest_rate": "0.09", "monthly_emi": "500.00", "remaining_months": 20})
    alice.put("/api/v1/household/profile", json={"primary_earner_age": 36})
    bob.post("/api/v1/financials/accounts", json={"account_name": "Bob private", "account_type": "savings", "balance": "7.00"})

    data = alice.get("/api/v1/auth/export-data").json()
    assert data["plans"][0]["plan"]["goals"], "the plan itself is exported, not just its name"
    assert [a["details"]["account_name"] for a in data["accounts"]] == ["Savings"]
    assert [i["asset_name"] for i in data["investments"]] == ["Index fund"]
    assert [x["liability_name"] for x in data["liabilities"]] == ["Car loan"]
    assert [(t["category"], t["amount"]) for t in data["transactions"]] == [("Groceries", "250.00")]
    assert data["household_profile"]["is_saved"] is True
    assert data["household_profile"]["primary_earner_age"] == 36
    assert "Bob private" not in str(data)
    assert "password" not in str(data).lower()

    # With nothing saved the household section says so instead of inventing values.
    empty = bob.get("/api/v1/auth/export-data").json()
    assert empty["household_profile"]["is_saved"] is False
    assert empty["household_profile"]["primary_earner_age"] is None
