from decimal import Decimal

from app.engine.insurance import (
    calculate_endowment_bonus,
    calculate_home_insurance_valuation,
    calculate_motor_idv,
    calculate_ulip_projection,
)


def test_motor_idv_depreciation_schedule():
    """Verify motor IDV conforms to standard depreciation schedule."""
    ex_showroom = Decimal("1000000.00")

    # Up to 6 months: 5% depreciation -> IDV 9,50,000
    idv_5m = calculate_motor_idv(ex_showroom, vehicle_age_months=5)
    assert idv_5m["insured_declared_value"] == Decimal("950000.00")
    assert idv_5m["depreciation_percentage"] == Decimal("5.0")

    # 18 months: 20% depreciation -> IDV 8,00,000
    idv_18m = calculate_motor_idv(ex_showroom, vehicle_age_months=18)
    assert idv_18m["insured_declared_value"] == Decimal("800000.00")
    assert idv_18m["depreciation_percentage"] == Decimal("20.0")

    # 42 months: 40% depreciation -> IDV 6,00,000
    idv_42m = calculate_motor_idv(ex_showroom, vehicle_age_months=42)
    assert idv_42m["insured_declared_value"] == Decimal("600000.00")


def test_ulip_fund_value_vs_death_benefit():
    """ULIP fund value must remain distinct from death benefit."""
    annual_prem = Decimal("100000.00")
    sum_assured = Decimal("1000000.00")

    # 2 years in: fund value is still smaller than 10L sum assured
    proj_2y = calculate_ulip_projection(
        annual_premium=annual_prem,
        years_completed=2,
        assumed_annual_return=Decimal("0.10"),
        mortality_charge_annual=Decimal("2000.00"),
        fund_management_charge_pct=Decimal("1.35"),
        sum_assured=sum_assured,
    )
    assert proj_2y["is_locked_in"] is True
    assert proj_2y["fund_value"] < sum_assured
    # Death benefit (Type 1) is max(sum_assured, fund_value) = 10,00,000
    assert proj_2y["death_benefit_type_1_max"] == sum_assured


def test_endowment_bonus_accrual():
    """Traditional endowment simple reversionary bonus accrual."""
    sum_assured = Decimal("500000.00")
    rate_per_k = Decimal("45.00")  # Rs 45 per Rs 1,000 of sum assured

    # After 10 years: annual bonus = (5,00,000 / 1000) * 45 = 22,500. Accrued for 10y = 2,25,000.
    res = calculate_endowment_bonus(
        sum_assured=sum_assured,
        reversionary_bonus_rate_per_thousand=rate_per_k,
        years_completed=10,
    )
    assert res["annual_reversionary_bonus"] == Decimal("22500.00")
    assert res["accrued_reversionary_bonus"] == Decimal("225000.00")
    assert res["total_effective_benefit"] == Decimal("725000.00")


def test_home_insurance_excludes_land_market_value():
    """Building reinstatement cost must be strictly separated from land market value."""
    area = Decimal("1500.00")
    rate_sqft = Decimal("2500.00")  # structure: 37,50,000
    content = Decimal("500000.00")  # content: 5,00,000
    land_val = Decimal("6000000.00")  # land: 60,00,000 (NOT insurable)

    res = calculate_home_insurance_valuation(
        built_up_area_sqft=area,
        construction_cost_per_sqft=rate_sqft,
        content_value=content,
        land_market_value=land_val,
    )
    assert res["structure_reinstatement_value"] == Decimal("3750000.00")
    assert res["total_insurable_sum_insured"] == Decimal("4250000.00")
    assert res["land_market_value_uninsured"] == land_val
