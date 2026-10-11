"""Bootstrap schema

Revision ID: 0001_bootstrap_schema
Revises:
Create Date: 2026-03-22 00:00:00
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0001_bootstrap_schema"
down_revision = None
branch_labels = None
depends_on = None

DEFAULT_TABLES = "1,2,3,4,5,6,7,8,9,10"


def _has_table(table_name):
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table_name, column_name):
    columns = sa.inspect(op.get_bind()).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade():
    if not _has_table("users"):
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("username", sa.String(length=100), nullable=False),
            sa.Column("password", sa.String(length=200), nullable=False),
            sa.Column("is_admin", sa.Integer(), nullable=True, server_default="0"),
            sa.Column("expiry", sa.String(length=20), nullable=True),
            sa.Column("whatsapp", sa.String(length=20), nullable=True),
            sa.Column("address", sa.String(length=300), nullable=True),
            sa.Column("banner", sa.String(length=200), nullable=True),
            sa.Column("logo", sa.String(length=200), nullable=True),
            sa.Column("upi_qr", sa.String(length=200), nullable=True),
            sa.Column("table_numbers", sa.String(length=500), nullable=True, server_default=DEFAULT_TABLES),
            sa.Column("slogan", sa.String(length=200), nullable=True, server_default=""),
            sa.Column("theme_preset", sa.String(length=50), nullable=True, server_default="default"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("username"),
        )

    if not _has_table("menu"):
        op.create_table(
            "menu",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("item", sa.String(length=200), nullable=False),
            sa.Column("price", sa.String(length=20), nullable=False),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("image", sa.String(length=200), nullable=True),
            sa.Column("available", sa.Integer(), nullable=True, server_default="1"),
            sa.Column("stock", sa.Integer(), nullable=True, server_default="-1"),
            sa.Column("daily_limit", sa.Integer(), nullable=True, server_default="-1"),
            sa.Column("last_reset_date", sa.String(length=20), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("orders"):
        op.create_table(
            "orders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("table_no", sa.String(length=20), nullable=False),
            sa.Column("items", sa.Text(), nullable=True),
            sa.Column("notes", sa.String(length=500), nullable=True, server_default=""),
            sa.Column("total", sa.Float(), nullable=True, server_default="0"),
            sa.Column("status", sa.String(length=20), nullable=True, server_default="pending"),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if not _has_table("order_items"):
        op.create_table(
            "order_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("item_name", sa.String(length=200), nullable=False),
            sa.Column("price", sa.Float(), nullable=False),
            sa.Column("quantity", sa.Integer(), nullable=True, server_default="1"),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if _has_table("users"):
        with op.batch_alter_table("users", schema=None) as batch_op:
            if not _has_column("users", "logo"):
                batch_op.add_column(sa.Column("logo", sa.String(length=200), nullable=True))
            if not _has_column("users", "upi_qr"):
                batch_op.add_column(sa.Column("upi_qr", sa.String(length=200), nullable=True))
            if not _has_column("users", "table_numbers"):
                batch_op.add_column(sa.Column("table_numbers", sa.String(length=500), nullable=True))
            if not _has_column("users", "slogan"):
                batch_op.add_column(sa.Column("slogan", sa.String(length=200), nullable=True, server_default=""))
            if not _has_column("users", "theme_preset"):
                batch_op.add_column(sa.Column("theme_preset", sa.String(length=50), nullable=True, server_default="default"))

    if _has_table("menu"):
        with op.batch_alter_table("menu", schema=None) as batch_op:
            if not _has_column("menu", "available"):
                batch_op.add_column(sa.Column("available", sa.Integer(), nullable=True, server_default="1"))
            if not _has_column("menu", "stock"):
                batch_op.add_column(sa.Column("stock", sa.Integer(), nullable=True, server_default="-1"))
            if not _has_column("menu", "daily_limit"):
                batch_op.add_column(sa.Column("daily_limit", sa.Integer(), nullable=True, server_default="-1"))
            if not _has_column("menu", "last_reset_date"):
                batch_op.add_column(sa.Column("last_reset_date", sa.String(length=20), nullable=True))

    if _has_table("orders"):
        with op.batch_alter_table("orders", schema=None) as batch_op:
            if not _has_column("orders", "notes"):
                batch_op.add_column(sa.Column("notes", sa.String(length=500), nullable=True, server_default=""))
            if not _has_column("orders", "total"):
                batch_op.add_column(sa.Column("total", sa.Float(), nullable=True, server_default="0"))
            if not _has_column("orders", "status"):
                batch_op.add_column(sa.Column("status", sa.String(length=20), nullable=True, server_default="pending"))
            if not _has_column("orders", "created_at"):
                batch_op.add_column(sa.Column("created_at", sa.DateTime(), nullable=True))
            if not _has_column("orders", "items"):
                batch_op.add_column(sa.Column("items", sa.Text(), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE users
            SET table_numbers = :default_tables
            WHERE table_numbers IS NULL OR TRIM(table_numbers) = ''
            """
        ),
        {"default_tables": DEFAULT_TABLES},
    )


def downgrade():
    raise NotImplementedError("Downgrade is not supported for the bootstrap migration.")
