from app.security import mask_sensitive_data


def test_mask_sensitive_data():
    payload = {
        "user_id": "usr_123",
        "email": "user@example.com",
        "password": "SecretPassword123!",
        "hashed_password": "$2b$12$somehashvaluehere",
        "access_token": "eyJh...sample_jwt_token",
        "policy_number": "POL-999-SECRET",
        "medical_notes": "Private medical diagnosis",
        "financial_details": {
            "account_number": "AC1234567890",
            "balance": "100000.00",
            "pan": "ABCDE1234F",
        },
        "non_sensitive_list": [
            {"label": "Tuition", "amount": "50000.00"},
            {"secret": "inner_secret", "name": "safe"},
        ],
    }

    masked = mask_sensitive_data(payload)

    assert masked["password"] == "[REDACTED]"
    assert masked["hashed_password"] == "[REDACTED]"
    assert masked["access_token"] == "[REDACTED]"
    assert masked["policy_number"] == "[REDACTED]"
    assert masked["medical_notes"] == "[REDACTED]"
    assert masked["financial_details"]["account_number"] == "[REDACTED]"
    assert masked["financial_details"]["pan"] == "[REDACTED]"
    assert masked["financial_details"]["balance"] == "100000.00"
    assert masked["non_sensitive_list"][1]["secret"] == "[REDACTED]"
    assert masked["non_sensitive_list"][1]["name"] == "safe"
