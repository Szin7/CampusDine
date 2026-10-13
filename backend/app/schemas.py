from datetime import date, datetime, timezone

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictBool, StringConstraints, field_serializer, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Username = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.-]+$")]
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]
Role = Literal["student", "staff", "admin"]


class Login(BaseModel):
    role: Role
    username: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class StudentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    roll_no: str
    name: str
    department: str
    semester: int
    email: str
    approval_status: str
    is_active: bool
    wallet_balance: int
    credit_balance: int
    credit_limit: int


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]


class StaffCreate(BaseModel):
    name: ShortText
    username: Username
    password: Password


class StaffView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    username: str
    is_active: bool


class CounterStudent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    roll_no: str
    name: str
    department: str
    semester: int
    wallet_balance: int
    credit_balance: int
    credit_limit: int


class IdentificationResult(BaseModel):
    status: Literal["matched", "not_found", "ambiguous"]
    student: CounterStudent | None = None
    message: str


MenuCategory = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
MenuPrice = Annotated[int, Field(strict=True, gt=0, le=2_147_483_647, description="Price in paisa; NPR 120 is 12000.")]


class MenuCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ShortText
    price: MenuPrice
    category: MenuCategory
    is_available: StrictBool = True


class MenuUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ShortText | None = None
    price: MenuPrice | None = None
    category: MenuCategory | None = None
    is_available: StrictBool | None = None
    is_archived: StrictBool | None = None

    @model_validator(mode="after")
    def check_changes(self):
        if not self.model_fields_set:
            raise ValueError("Provide at least one menu field to update.")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Menu fields cannot be null.")
        return self


class MenuView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    price: int
    category: str
    is_available: bool
    is_archived: bool


class CheckoutItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    menu_item_id: Annotated[int, Field(strict=True, gt=0)]
    quantity: Annotated[int, Field(strict=True, ge=1, le=50)]


class CheckoutCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    checkout_key: Annotated[str, StringConstraints(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
    items: Annotated[list[CheckoutItem], Field(min_length=1, max_length=50)]
    expected_total: Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]

    @model_validator(mode="after")
    def unique_items(self):
        ids = [item.menu_item_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Combine repeated menu items into one line with a quantity.")
        return self


class CounterCheckoutCreate(CheckoutCreate):
    student_id: Annotated[int, Field(strict=True, gt=0)]


class OrderItemView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    menu_item_id: int
    item_name: str
    unit_price: int
    quantity: int


class OrderView(BaseModel):
    revision: int
    id: int
    student_id: int
    student_name: str
    token_number: int
    order_date: date
    status: str
    total_amount: int
    payment_type: Literal["wallet", "credit"]
    created_at: datetime
    items: list[OrderItemView]

    @field_serializer("created_at")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()


class AccountSummary(BaseModel):
    student_id: int
    roll_no: str
    name: str
    wallet_balance: int
    credit_balance: int
    credit_limit: int
    remaining_credit: int


class WalletTopUp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_key: Annotated[str, StringConstraints(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
    amount: Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
    reference: ShortText


class CreditLimitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    credit_limit: Annotated[int, Field(strict=True, ge=0, le=2_147_483_647)]
    expected_credit_limit: Annotated[int, Field(strict=True, ge=0, le=2_147_483_647)]
    reason: ShortText


class WalletTransactionView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    amount: int
    type: str
    order_id: int | None
    admin_id: int | None
    reference: str | None
    timestamp: datetime

    @field_serializer("timestamp")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()


class CreditEntryView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    order_id: int
    amount: int
    status: str
    month: str
    created_at: datetime
    settled_at: datetime | None
    settlement_reference: str | None

    @field_serializer("created_at", "settled_at")
    def utc_timestamp(self, value: datetime | None):
        return value.replace(tzinfo=timezone.utc).isoformat() if value else None


class CreditLimitChangeView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    admin_id: int
    old_limit: int
    new_limit: int
    reason: str
    changed_at: datetime

    @field_serializer("changed_at")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()


OrderStatus = Literal["received", "preparing", "ready", "collected"]


class OrderStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_status: OrderStatus
    status: OrderStatus


class OrderStatusView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    status: OrderStatus
    changed_at: datetime
    changed_by_staff_id: int | None

    @field_serializer("changed_at")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()


class StaffQueue(BaseModel):
    orders: list[OrderView]
    total: int
    limit: int
    offset: int


class OutstandingDues(BaseModel):
    student_id: int
    roll_no: str
    name: str
    department: str
    month: str
    amount: int
    ledger_ids: list[int]


class SettlementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_key: Annotated[str, StringConstraints(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
    student_id: Annotated[int, Field(strict=True, gt=0)]
    ledger_ids: Annotated[list[Annotated[int, Field(strict=True, gt=0)]], Field(min_length=1, max_length=500)]
    expected_amount: Annotated[int, Field(strict=True, gt=0, le=2_147_483_647)]
    reference: ShortText

    @model_validator(mode="after")
    def unique_entries(self):
        if len(self.ledger_ids) != len(set(self.ledger_ids)):
            raise ValueError("Each ledger entry must appear only once.")
        return self


class SettlementView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    request_key: str
    student_id: int
    admin_id: int
    amount: int
    ledger_ids: list[int]
    reference: str
    created_at: datetime

    @field_serializer("created_at")
    def utc_timestamp(self, value: datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()


class StudentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: ShortText | None = None
    department: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = None
    semester: Annotated[int, Field(strict=True, ge=1, le=8)] | None = None
    email: EmailStr | None = None
    is_active: StrictBool | None = None

    @model_validator(mode="after")
    def check_fields(self):
        if not self.model_fields_set or any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Provide at least one non-null student field.")
        return self


class SalesPeriod(BaseModel):
    period: str
    order_count: int
    sales_amount: int
    wallet_sales: int
    credit_sales: int


class SalesReport(BaseModel):
    currency: Literal["NPR"] = "NPR"
    amount_unit: Literal["paisa"] = "paisa"
    start_date: date
    end_date: date
    order_count: int
    sales_amount: int
    wallet_sales: int
    credit_sales: int
    periods: list[SalesPeriod]


class RecommendedItem(BaseModel):
    item: MenuView
    source: Literal["usual", "collaborative", "popular", "menu"]


class RecommendationsView(BaseModel):
    items: list[RecommendedItem]
