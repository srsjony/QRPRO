from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


MONEY_QUANTUM = Decimal("0.01")


def parse_price(value):
    raw_value = str(value).strip()
    if not raw_value:
        raise ValueError("Price is required.")

    try:
        amount = Decimal(raw_value)
    except InvalidOperation as exc:
        raise ValueError("Price must be a valid number.") from exc

    if amount <= 0:
        raise ValueError("Price must be greater than zero.")

    return amount.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def normalize_price(value):
    amount = parse_price(value)
    formatted = format(amount, "f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted
