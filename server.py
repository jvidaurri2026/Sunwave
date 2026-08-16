from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlparse
import argparse
import csv
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, time as clock_time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SUNWAVE_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "equiptrack.db"
GROUPME_SETTINGS_PATH = DATA_DIR / "groupme-settings.json"
GROUPME_CALLBACK_LOG_PATH = DATA_DIR / "groupme-callback.log"
LOCAL_TZ = ZoneInfo("America/Chicago")
INVENTORY_FINISH_DATE_KEY = "inventory_finish_date"
INVENTORY_AUTO_SENT_DATE_KEY = "inventory_auto_groupme_sent_date"
INVENTORY_AUTO_SEND_HOUR = 21
INVENTORY_AUTO_SEND_MINUTE = 0
WHATSAPP_ENABLED_KEY = "shop_whatsapp_enabled"
WHATSAPP_TOKEN_KEY = "shop_whatsapp_access_token"
WHATSAPP_PHONE_NUMBER_ID_KEY = "shop_whatsapp_phone_number_id"
WHATSAPP_RECIPIENT_KEY = "shop_whatsapp_recipient"
WHATSAPP_API_VERSION_KEY = "shop_whatsapp_api_version"
WHATSAPP_VERIFY_TOKEN_KEY = "shop_whatsapp_verify_token"
YARD_JOB_NAME = "Big Spring Yard"
OUT_OF_SERVICE_STATUSES = ("Diagnosing", "Waiting for Parts", "Needs 3rd Party", "Repairing at 3rd Party", "Sent to Auction", "Fixed")
THIRD_PARTY_OUT_OF_SERVICE_STATUSES = ("Needs 3rd Party", "Repairing at 3rd Party")

DEFAULT_USERS = [
    ("admin", "admin123", "Admin User", "Admin"),
    ("manager", "manager123", "Field Manager", "Manager"),
    ("viewer", "viewer123", "Viewer User", "Viewer"),
]

DEFAULT_EQUIPMENT = [
    ("sample-comm-trailer", "GEN-0012", "EQ-0001", "Comm Trailer", "Available", "", "Yard 3", "29.7604", "-95.3698", "Ready for deployment."),
    ("sample-pump", "TAB-0142", "IT-0142", "Pump", "Available", "", "Main Office", "30.2672", "-97.7431", "Screen replacement scheduled."),
]

DEFAULT_CATEGORIES = [
    "Comm Trailer",
    "Manifold",
    "Half Pipe 12\"",
    "Half Pipe 16\"",
    "Traditional",
    "Pump",
    "Ground Manifold 4x4",
    "Ground Manifold 4x3",
    "Ground Manifold 2x2",
]

DEFAULT_JOBS = []
DEFAULT_QUANTITY_ASSET_CATEGORY = "12\" to 10\" Reducer"
DEFAULT_QUANTITY_ASSET_MASTER_NUMBER = "9000"


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def local_today():
    return datetime.now(LOCAL_TZ).date().isoformat()


def local_now_label():
    return datetime.now(LOCAL_TZ).strftime("%b %d, %Y %I:%M %p")


def password_hash(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def is_available_assignment(value):
    return not (value or "").strip() or (value or "").strip().lower() == "available"


def is_yard_assignment(value):
    return (value or "").strip().lower() in ("yard", YARD_JOB_NAME.lower())


def is_real_job_assignment(value):
    return bool((value or "").strip()) and not is_available_assignment(value) and not is_yard_assignment(value)


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DATA_DIR.mkdir(exist_ok=True)
    bundled_db = ROOT / "data" / "equiptrack.db"
    if not DB_PATH.exists() and bundled_db.exists() and bundled_db.resolve() != DB_PATH.resolve():
        shutil.copy2(bundled_db, DB_PATH)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              username TEXT PRIMARY KEY,
              password_hash TEXT NOT NULL,
              name TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Viewer', 'Tracker Viewer', 'Shop Viewer', 'Scheduler', 'Technician'))
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              username TEXT NOT NULL REFERENCES users(username),
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS equipment (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              asset_tag TEXT NOT NULL,
              category TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('Active', 'Available', 'Maintenance', 'Retired')),
              assigned_to TEXT,
              site TEXT,
              latitude TEXT,
              longitude TEXT,
              photos TEXT,
              notes TEXT,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
              name TEXT PRIMARY KEY,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS jobs (
              name TEXT PRIMARY KEY,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS asset_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              equipment_id TEXT NOT NULL,
              equipment_name TEXT NOT NULL,
              asset_tag TEXT NOT NULL,
              assigned_to TEXT,
              latitude TEXT,
              longitude TEXT,
              changed_by TEXT,
              changed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_audits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              audit_date TEXT NOT NULL,
              job_name TEXT NOT NULL,
              item_type TEXT NOT NULL,
              asset_number TEXT,
              hose_size TEXT,
              total_hose TEXT,
              latitude TEXT,
              longitude TEXT,
              notes TEXT,
              created_by TEXT,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS saved_job_audits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              batch_id TEXT NOT NULL,
              status TEXT NOT NULL,
              audit_date TEXT NOT NULL,
              job_name TEXT NOT NULL,
              item_type TEXT NOT NULL,
              asset_number TEXT,
              hose_size TEXT,
              total_hose TEXT,
              latitude TEXT,
              longitude TEXT,
              notes TEXT,
              created_by TEXT,
              created_at TEXT NOT NULL,
              saved_by TEXT,
              saved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_audit_asset_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              batch_id TEXT NOT NULL,
              job_name TEXT NOT NULL,
              asset_number TEXT NOT NULL,
              equipment_id TEXT,
              equipment_name TEXT,
              asset_tag TEXT,
              audit_status TEXT NOT NULL,
              released_status TEXT NOT NULL,
              changed_by TEXT,
              changed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quantity_assets (
              category TEXT PRIMARY KEY,
              master_number TEXT NOT NULL,
              quantity INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS quantity_asset_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              category TEXT NOT NULL,
              master_number TEXT NOT NULL,
              job_name TEXT,
              change_type TEXT NOT NULL CHECK(change_type IN ('Add', 'Use')),
              quantity INTEGER NOT NULL,
              balance_after INTEGER NOT NULL,
              latitude TEXT,
              longitude TEXT,
              changed_by TEXT,
              changed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_parts (
              part_number TEXT PRIMARY KEY COLLATE NOCASE,
              description TEXT NOT NULL DEFAULT '',
              vendor TEXT NOT NULL DEFAULT 'Unspecified',
              price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
              quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
              unit_type TEXT NOT NULL DEFAULT '',
              unit_year TEXT NOT NULL DEFAULT '',
              fuel_type TEXT NOT NULL DEFAULT '',
              service_code TEXT NOT NULL DEFAULT '',
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_unit_types (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              unit_type TEXT NOT NULL COLLATE NOCASE,
              unit_year TEXT NOT NULL,
              make TEXT NOT NULL DEFAULT '',
              fuel_type TEXT NOT NULL DEFAULT '',
              model TEXT NOT NULL,
              asset_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
              vin TEXT NOT NULL UNIQUE COLLATE NOCASE,
              tire_size TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_part_years (
              part_number TEXT NOT NULL REFERENCES shop_parts(part_number) ON DELETE CASCADE,
              unit_year TEXT NOT NULL,
              PRIMARY KEY (part_number, unit_year)
            );

            CREATE TABLE IF NOT EXISTS shop_repair_codes (
              code TEXT PRIMARY KEY COLLATE NOCASE,
              description TEXT NOT NULL,
              labor_minutes INTEGER NOT NULL DEFAULT 0 CHECK(labor_minutes >= 0),
              requires_position INTEGER NOT NULL DEFAULT 0 CHECK(requires_position IN (0, 1)),
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_repair_orders (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              order_date TEXT NOT NULL,
              location TEXT NOT NULL,
              technician_username TEXT NOT NULL,
              technician_name TEXT NOT NULL,
              driver_name TEXT NOT NULL DEFAULT '',
              asset_number TEXT NOT NULL,
              asset_mileage TEXT NOT NULL,
              asset_hours TEXT NOT NULL,
              job_description TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Working on it', 'Completed', 'Cancelled')),
              additional_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(additional_cost_cents >= 0),
              source TEXT NOT NULL DEFAULT 'Repair Order',
              source_reference_id INTEGER,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_repair_order_codes (
              repair_order_id INTEGER NOT NULL REFERENCES shop_repair_orders(id) ON DELETE CASCADE,
              code TEXT NOT NULL,
              description TEXT NOT NULL,
              labor_minutes INTEGER NOT NULL DEFAULT 0 CHECK(labor_minutes >= 0),
              positions TEXT NOT NULL DEFAULT '',
              PRIMARY KEY (repair_order_id, code)
            );

            CREATE TABLE IF NOT EXISTS shop_repair_code_options (
              code TEXT NOT NULL REFERENCES shop_repair_codes(code) ON DELETE CASCADE,
              option_name TEXT NOT NULL,
              labor_minutes INTEGER CHECK(labor_minutes IS NULL OR labor_minutes >= 0),
              PRIMARY KEY (code, option_name)
            );

            CREATE TABLE IF NOT EXISTS shop_repair_order_code_options (
              repair_order_id INTEGER NOT NULL REFERENCES shop_repair_orders(id) ON DELETE CASCADE,
              code TEXT NOT NULL,
              option_name TEXT NOT NULL,
              labor_minutes INTEGER CHECK(labor_minutes IS NULL OR labor_minutes >= 0),
              PRIMARY KEY (repair_order_id, code, option_name)
            );

            CREATE TABLE IF NOT EXISTS shop_repair_order_parts (
              repair_order_id INTEGER NOT NULL REFERENCES shop_repair_orders(id) ON DELETE CASCADE,
              part_number TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              vendor TEXT NOT NULL DEFAULT 'Unspecified',
              quantity INTEGER NOT NULL CHECK(quantity > 0),
              unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
              PRIMARY KEY (repair_order_id, part_number)
            );

            CREATE TABLE IF NOT EXISTS shop_service_schedules (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              scheduled_date TEXT NOT NULL,
              original_scheduled_date TEXT NOT NULL DEFAULT '',
              working_started_at TEXT NOT NULL DEFAULT '',
              completed_at TEXT NOT NULL DEFAULT '',
              scheduled_time TEXT NOT NULL,
              shift TEXT NOT NULL DEFAULT 'Day' CHECK(shift IN ('Day', 'Night')),
              location TEXT NOT NULL,
              asset_number TEXT NOT NULL,
              driver_name TEXT NOT NULL DEFAULT '',
              technician_name TEXT NOT NULL,
              technician_username TEXT NOT NULL DEFAULT '',
              priority TEXT NOT NULL CHECK(priority IN ('Low', 'Normal', 'High', 'Urgent')),
              notes TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'Working on it', 'Completed', 'Cancelled')),
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              repair_order_id INTEGER REFERENCES shop_repair_orders(id)
            );

            CREATE TABLE IF NOT EXISTS shop_service_schedule_codes (
              schedule_id INTEGER NOT NULL REFERENCES shop_service_schedules(id) ON DELETE CASCADE,
              code TEXT NOT NULL,
              description TEXT NOT NULL,
              labor_minutes INTEGER NOT NULL DEFAULT 0 CHECK(labor_minutes >= 0),
              PRIMARY KEY (schedule_id, code)
            );

            CREATE TABLE IF NOT EXISTS shop_service_day_statuses (
              service_date TEXT PRIMARY KEY,
              status TEXT NOT NULL CHECK(status IN ('Available', 'Unavailable')),
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_out_of_service (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              asset_number TEXT NOT NULL COLLATE NOCASE,
              issue TEXT NOT NULL,
              out_date TEXT NOT NULL,
              eta_date TEXT NOT NULL DEFAULT '',
              eta_not_available INTEGER NOT NULL DEFAULT 0 CHECK(eta_not_available IN (0, 1)),
              status TEXT NOT NULL DEFAULT 'Diagnosing' CHECK(status IN ('Diagnosing', 'Waiting for Parts', 'Needs 3rd Party', 'Repairing at 3rd Party', 'Sent to Auction', 'Fixed')),
              third_party_shop TEXT NOT NULL DEFAULT '',
              third_party_send_date TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              fixed_at TEXT NOT NULL DEFAULT '',
              repair_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(repair_cost_cents >= 0),
              repair_notes TEXT NOT NULL DEFAULT '',
              completed_date TEXT NOT NULL DEFAULT '',
              repair_order_id INTEGER REFERENCES shop_repair_orders(id)
            );

            CREATE TABLE IF NOT EXISTS shop_part_orders (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              part_number TEXT NOT NULL COLLATE NOCASE,
              description TEXT NOT NULL DEFAULT '',
              vendor TEXT NOT NULL DEFAULT 'Unspecified',
              quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
              purchase_type TEXT NOT NULL DEFAULT 'Unit Part' CHECK(purchase_type IN ('Unit Part', 'Job Material', 'Tire Inventory')),
              asset_number TEXT NOT NULL DEFAULT '',
              unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_cents >= 0),
              order_date TEXT NOT NULL,
              pickup_date TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'Waiting for Order' CHECK(status IN ('Waiting for Order', 'Order Received')),
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_by TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shop_whatsapp_webhook_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL DEFAULT '',
              message_id TEXT NOT NULL DEFAULT '',
              message_status TEXT NOT NULL DEFAULT '',
              recipient_number TEXT NOT NULL DEFAULT '',
              event_timestamp TEXT NOT NULL DEFAULT '',
              payload_json TEXT NOT NULL,
              received_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_out_of_service_active_asset
            ON shop_out_of_service(asset_number)
            WHERE status <> 'Fixed';
            """
        )

        users_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()["sql"]
        if "'Technician'" not in users_sql:
            conn.executescript(
                """
                ALTER TABLE sessions RENAME TO sessions_old;
                CREATE TABLE users_new (
                  username TEXT PRIMARY KEY,
                  password_hash TEXT NOT NULL,
                  name TEXT NOT NULL,
                  role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Viewer', 'Scheduler', 'Technician'))
                );
                INSERT INTO users_new (username, password_hash, name, role)
                SELECT username, password_hash, name, role FROM users;
                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
                CREATE TABLE sessions (
                  token TEXT PRIMARY KEY,
                  username TEXT NOT NULL REFERENCES users(username),
                  created_at TEXT NOT NULL
                );
                INSERT INTO sessions (token, username, created_at)
                SELECT token, username, created_at FROM sessions_old
                WHERE username IN (SELECT username FROM users);
                DROP TABLE sessions_old;
                """
            )

        users_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()["sql"]
        if "'Tracker Viewer'" not in users_sql:
            conn.executescript(
                """
                ALTER TABLE sessions RENAME TO sessions_old;
                CREATE TABLE users_new (
                  username TEXT PRIMARY KEY,
                  password_hash TEXT NOT NULL,
                  name TEXT NOT NULL,
                  role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Viewer', 'Tracker Viewer', 'Scheduler', 'Technician'))
                );
                INSERT INTO users_new (username, password_hash, name, role)
                SELECT username, password_hash, name, role FROM users;
                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
                CREATE TABLE sessions (
                  token TEXT PRIMARY KEY,
                  username TEXT NOT NULL REFERENCES users(username),
                  created_at TEXT NOT NULL
                );
                INSERT INTO sessions (token, username, created_at)
                SELECT token, username, created_at FROM sessions_old
                WHERE username IN (SELECT username FROM users);
                DROP TABLE sessions_old;
                """
            )

        users_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()["sql"]
        if "'Shop Viewer'" not in users_sql:
            conn.executescript(
                """
                ALTER TABLE sessions RENAME TO sessions_old;
                CREATE TABLE users_new (
                  username TEXT PRIMARY KEY,
                  password_hash TEXT NOT NULL,
                  name TEXT NOT NULL,
                  role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Viewer', 'Tracker Viewer', 'Shop Viewer', 'Scheduler', 'Technician'))
                );
                INSERT INTO users_new (username, password_hash, name, role)
                SELECT username, password_hash, name, role FROM users;
                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
                CREATE TABLE sessions (
                  token TEXT PRIMARY KEY,
                  username TEXT NOT NULL REFERENCES users(username),
                  created_at TEXT NOT NULL
                );
                INSERT INTO sessions (token, username, created_at)
                SELECT token, username, created_at FROM sessions_old
                WHERE username IN (SELECT username FROM users);
                DROP TABLE sessions_old;
                """
            )

        out_of_service_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_out_of_service)").fetchall()}
        if "eta_date" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN eta_date TEXT NOT NULL DEFAULT ''")
        if "eta_not_available" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN eta_not_available INTEGER NOT NULL DEFAULT 0")
        if "repair_cost_cents" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN repair_cost_cents INTEGER NOT NULL DEFAULT 0")
        if "repair_notes" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN repair_notes TEXT NOT NULL DEFAULT ''")
        if "completed_date" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN completed_date TEXT NOT NULL DEFAULT ''")
        if "repair_order_id" not in out_of_service_columns:
            conn.execute("ALTER TABLE shop_out_of_service ADD COLUMN repair_order_id INTEGER REFERENCES shop_repair_orders(id)")

        out_of_service_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shop_out_of_service'"
        ).fetchone()["sql"]
        if "Sent to Auction" not in out_of_service_sql:
            conn.executescript(
                """
                CREATE TABLE shop_out_of_service_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  asset_number TEXT NOT NULL COLLATE NOCASE,
                  issue TEXT NOT NULL,
                  out_date TEXT NOT NULL,
                  eta_date TEXT NOT NULL DEFAULT '',
                  eta_not_available INTEGER NOT NULL DEFAULT 0 CHECK(eta_not_available IN (0, 1)),
                  status TEXT NOT NULL DEFAULT 'Diagnosing' CHECK(status IN ('Diagnosing', 'Waiting for Parts', 'Needs 3rd Party', 'Repairing at 3rd Party', 'Sent to Auction', 'Fixed')),
                  third_party_shop TEXT NOT NULL DEFAULT '',
                  third_party_send_date TEXT NOT NULL DEFAULT '',
                  created_by TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_by TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  fixed_at TEXT NOT NULL DEFAULT '',
                  repair_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(repair_cost_cents >= 0),
                  repair_notes TEXT NOT NULL DEFAULT '',
                  completed_date TEXT NOT NULL DEFAULT '',
                  repair_order_id INTEGER REFERENCES shop_repair_orders(id)
                );
                INSERT INTO shop_out_of_service_new (
                  id, asset_number, issue, out_date, eta_date, eta_not_available, status,
                  third_party_shop, third_party_send_date, created_by, created_at, updated_by,
                  updated_at, fixed_at, repair_cost_cents, repair_notes, completed_date, repair_order_id
                )
                SELECT id, asset_number, issue, out_date, eta_date, eta_not_available, status,
                  third_party_shop, third_party_send_date, created_by, created_at, updated_by,
                  updated_at, fixed_at, repair_cost_cents, repair_notes, completed_date, repair_order_id
                FROM shop_out_of_service;
                DROP TABLE shop_out_of_service;
                ALTER TABLE shop_out_of_service_new RENAME TO shop_out_of_service;
                CREATE UNIQUE INDEX idx_shop_out_of_service_active_asset
                ON shop_out_of_service(asset_number)
                WHERE status <> 'Fixed';
                """
            )

        part_order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_part_orders)").fetchall()}
        if "purchase_type" not in part_order_columns:
            conn.execute("ALTER TABLE shop_part_orders ADD COLUMN purchase_type TEXT NOT NULL DEFAULT 'Unit Part'")
        if "asset_number" not in part_order_columns:
            conn.execute("ALTER TABLE shop_part_orders ADD COLUMN asset_number TEXT NOT NULL DEFAULT ''")
        if "unit_price_cents" not in part_order_columns:
            conn.execute("ALTER TABLE shop_part_orders ADD COLUMN unit_price_cents INTEGER NOT NULL DEFAULT 0")
        if "vendor" not in part_order_columns:
            conn.execute("ALTER TABLE shop_part_orders ADD COLUMN vendor TEXT NOT NULL DEFAULT 'Unspecified'")
        part_order_sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shop_part_orders'").fetchone()["sql"]
        if "Tire Inventory" not in (part_order_sql or ""):
            conn.executescript(
                """
                CREATE TABLE shop_part_orders_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  part_number TEXT NOT NULL COLLATE NOCASE,
                  description TEXT NOT NULL DEFAULT '',
                  vendor TEXT NOT NULL DEFAULT 'Unspecified',
                  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
                  purchase_type TEXT NOT NULL DEFAULT 'Unit Part' CHECK(purchase_type IN ('Unit Part', 'Job Material', 'Tire Inventory')),
                  asset_number TEXT NOT NULL DEFAULT '',
                  unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_cents >= 0),
                  order_date TEXT NOT NULL,
                  pickup_date TEXT NOT NULL DEFAULT '',
                  status TEXT NOT NULL DEFAULT 'Waiting for Order' CHECK(status IN ('Waiting for Order', 'Order Received')),
                  created_by TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_by TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                INSERT INTO shop_part_orders_new (
                  id, part_number, description, vendor, quantity, purchase_type, asset_number,
                  unit_price_cents, order_date, pickup_date, status, created_by, created_at, updated_by, updated_at
                )
                SELECT id, part_number, description, vendor, quantity, purchase_type, asset_number,
                  unit_price_cents, order_date, pickup_date, status, created_by, created_at, updated_by, updated_at
                FROM shop_part_orders;
                DROP TABLE shop_part_orders;
                ALTER TABLE shop_part_orders_new RENAME TO shop_part_orders;
                """
            )

        schedule_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_service_schedules)").fetchall()}
        if "original_scheduled_date" not in schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN original_scheduled_date TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE shop_service_schedules SET original_scheduled_date = scheduled_date WHERE original_scheduled_date = ''")
        if "working_started_at" not in schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN working_started_at TEXT NOT NULL DEFAULT ''")
        if "completed_at" not in schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN completed_at TEXT NOT NULL DEFAULT ''")
        conn.execute(
            "UPDATE shop_service_schedules SET original_scheduled_date = scheduled_date WHERE original_scheduled_date = ''"
        )
        conn.execute(
            "UPDATE shop_service_schedules SET working_started_at = updated_at WHERE status IN ('Working on it', 'Completed') AND working_started_at = ''"
        )
        conn.execute(
            "UPDATE shop_service_schedules SET completed_at = updated_at WHERE status = 'Completed' AND completed_at = ''"
        )

        repair_order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_orders)").fetchall()}
        if "additional_cost_cents" not in repair_order_columns:
            conn.execute("ALTER TABLE shop_repair_orders ADD COLUMN additional_cost_cents INTEGER NOT NULL DEFAULT 0")
        if "source" not in repair_order_columns:
            conn.execute("ALTER TABLE shop_repair_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'Repair Order'")
        if "source_reference_id" not in repair_order_columns:
            conn.execute("ALTER TABLE shop_repair_orders ADD COLUMN source_reference_id INTEGER")

        shop_part_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_parts)").fetchall()}
        if "description" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        if "vendor" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN vendor TEXT NOT NULL DEFAULT 'Unspecified'")
        if "unit_type" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN unit_type TEXT NOT NULL DEFAULT ''")
        if "unit_year" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN unit_year TEXT NOT NULL DEFAULT ''")
        if "service_code" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN service_code TEXT NOT NULL DEFAULT ''")
        if "fuel_type" not in shop_part_columns:
            conn.execute("ALTER TABLE shop_parts ADD COLUMN fuel_type TEXT NOT NULL DEFAULT ''")
        shop_order_part_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_order_parts)").fetchall()}
        if "vendor" not in shop_order_part_columns:
            conn.execute("ALTER TABLE shop_repair_order_parts ADD COLUMN vendor TEXT NOT NULL DEFAULT 'Unspecified'")
        if "description" not in shop_order_part_columns:
            conn.execute("ALTER TABLE shop_repair_order_parts ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            INSERT OR IGNORE INTO shop_part_years (part_number, unit_year)
            SELECT part_number, unit_year FROM shop_parts WHERE TRIM(unit_year) <> ''
            """
        )

        shop_repair_code_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_codes)").fetchall()}
        if "labor_minutes" not in shop_repair_code_columns:
            conn.execute("ALTER TABLE shop_repair_codes ADD COLUMN labor_minutes INTEGER NOT NULL DEFAULT 0")
        if "requires_position" not in shop_repair_code_columns:
            conn.execute("ALTER TABLE shop_repair_codes ADD COLUMN requires_position INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE shop_repair_codes SET requires_position = 1 WHERE code = '500' COLLATE NOCASE")
        shop_order_code_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_order_codes)").fetchall()}
        if "labor_minutes" not in shop_order_code_columns:
            conn.execute("ALTER TABLE shop_repair_order_codes ADD COLUMN labor_minutes INTEGER NOT NULL DEFAULT 0")
        if "positions" not in shop_order_code_columns:
            conn.execute("ALTER TABLE shop_repair_order_codes ADD COLUMN positions TEXT NOT NULL DEFAULT ''")
        code_200_options_migration = conn.execute(
            "SELECT value FROM app_settings WHERE key = 'shop_code_200_options_v1'"
        ).fetchone()
        if code_200_options_migration is None:
            conn.execute(
                "UPDATE shop_repair_codes SET description = 'L-Tank Service', updated_at = ? WHERE code = '200' COLLATE NOCASE",
                (iso_now(),),
            )
            conn.executemany(
                "INSERT OR IGNORE INTO shop_repair_code_options (code, option_name, labor_minutes) VALUES ('200', ?, NULL)",
                [
                    ("Remove and Replace L-Tank",),
                    ("Remove and Replace Fuel Pump",),
                    ("Diagnose Fuel Pump",),
                    ("Install L-Tank",),
                    ("Rewire Power Cable",),
                ],
            )
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('shop_code_200_options_v1', 'complete', ?)",
                (iso_now(),),
            )
        shop_order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_orders)").fetchall()}
        if "status" not in shop_order_columns:
            conn.execute("ALTER TABLE shop_repair_orders ADD COLUMN status TEXT NOT NULL DEFAULT 'Completed'")
        shop_order_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shop_repair_orders'"
        ).fetchone()["sql"]
        if "'Working on it'" not in (shop_order_sql or ""):
            conn.executescript(
                """
                CREATE TABLE shop_repair_orders_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  order_date TEXT NOT NULL,
                  location TEXT NOT NULL,
                  technician_username TEXT NOT NULL,
                  technician_name TEXT NOT NULL,
                  driver_name TEXT NOT NULL DEFAULT '',
                  asset_number TEXT NOT NULL,
                  asset_mileage TEXT NOT NULL,
                  asset_hours TEXT NOT NULL,
                  job_description TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'Completed' CHECK(status IN ('Working on it', 'Completed', 'Cancelled')),
                  created_at TEXT NOT NULL
                );
                INSERT INTO shop_repair_orders_new (
                  id, order_date, location, technician_username, technician_name, driver_name,
                  asset_number, asset_mileage, asset_hours, job_description, status, created_at
                )
                SELECT id, order_date, location, technician_username, technician_name, '',
                       asset_number, asset_mileage, asset_hours, job_description, status, created_at
                FROM shop_repair_orders;
                DROP TABLE shop_repair_orders;
                ALTER TABLE shop_repair_orders_new RENAME TO shop_repair_orders;
                """
            )
        shop_order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_repair_orders)").fetchall()}
        if "driver_name" not in shop_order_columns:
            conn.execute("ALTER TABLE shop_repair_orders ADD COLUMN driver_name TEXT NOT NULL DEFAULT ''")
        shop_schedule_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_service_schedules)").fetchall()}
        if "repair_order_id" not in shop_schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN repair_order_id INTEGER REFERENCES shop_repair_orders(id)")
        if "shift" not in shop_schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN shift TEXT NOT NULL DEFAULT 'Day'")
        if "technician_username" not in shop_schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN technician_username TEXT NOT NULL DEFAULT ''")
        if "driver_name" not in shop_schedule_columns:
            conn.execute("ALTER TABLE shop_service_schedules ADD COLUMN driver_name TEXT NOT NULL DEFAULT ''")

        shop_unit_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_unit_types)").fetchall()}
        if "id" not in shop_unit_columns:
            conn.executescript(
                """
                CREATE TABLE shop_unit_types_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  unit_type TEXT NOT NULL COLLATE NOCASE,
                  unit_year TEXT NOT NULL,
                  make TEXT NOT NULL DEFAULT '',
                  fuel_type TEXT NOT NULL DEFAULT '',
                  model TEXT NOT NULL,
                  asset_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
                  vin TEXT NOT NULL UNIQUE COLLATE NOCASE,
                  tire_size TEXT NOT NULL DEFAULT '',
                  created_by TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                INSERT INTO shop_unit_types_new (
                  unit_type, unit_year, make, fuel_type, model, asset_number, vin, tire_size, created_by, created_at
                )
                SELECT unit_type, unit_year, '', 'Diesel', '', printf('LEGACY-%04d', rowid), printf('LEGACYVIN-%04d', rowid), '', created_by, created_at
                FROM shop_unit_types;
                DROP TABLE shop_unit_types;
                ALTER TABLE shop_unit_types_new RENAME TO shop_unit_types;
                """
            )
            shop_unit_columns = {row["name"] for row in conn.execute("PRAGMA table_info(shop_unit_types)").fetchall()}
        if "make" not in shop_unit_columns:
            conn.execute("ALTER TABLE shop_unit_types ADD COLUMN make TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE shop_unit_types SET make = 'Ford'")
        if "fuel_type" not in shop_unit_columns:
            conn.execute("ALTER TABLE shop_unit_types ADD COLUMN fuel_type TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE shop_unit_types SET fuel_type = 'Diesel'")
        if "tire_size" not in shop_unit_columns:
            conn.execute("ALTER TABLE shop_unit_types ADD COLUMN tire_size TEXT NOT NULL DEFAULT ''")

        equipment_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'equipment'"
        ).fetchone()["sql"]
        if "'Available'" not in equipment_sql:
            conn.executescript(
                """
                CREATE TABLE equipment_new (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  asset_tag TEXT NOT NULL,
                  category TEXT NOT NULL,
                  status TEXT NOT NULL CHECK(status IN ('Active', 'Available', 'Maintenance', 'Retired')),
                  assigned_to TEXT,
                  site TEXT,
                  latitude TEXT,
                  longitude TEXT,
                  notes TEXT,
                  updated_at TEXT NOT NULL
                );
                INSERT INTO equipment_new (
                  id, name, asset_tag, category, status, assigned_to,
                  site, latitude, longitude, notes, updated_at
                )
                SELECT
                  id, name, asset_tag, category, status, assigned_to,
                  site, latitude, longitude, notes, updated_at
                FROM equipment;
                DROP TABLE equipment;
                ALTER TABLE equipment_new RENAME TO equipment;
                """
            )

        existing_equipment_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(equipment)").fetchall()
        }
        if "photos" not in existing_equipment_columns:
            conn.execute("ALTER TABLE equipment ADD COLUMN photos TEXT")

        existing_job_audit_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(job_audits)").fetchall()
        }
        if "hose_size" not in existing_job_audit_columns:
            conn.execute("ALTER TABLE job_audits ADD COLUMN hose_size TEXT")
        if "total_hose" not in existing_job_audit_columns:
            conn.execute("ALTER TABLE job_audits ADD COLUMN total_hose TEXT")

        existing_saved_job_audit_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(saved_job_audits)").fetchall()
        }
        if "total_hose" not in existing_saved_job_audit_columns:
            conn.execute("ALTER TABLE saved_job_audits ADD COLUMN total_hose TEXT")

        existing_quantity_history_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(quantity_asset_history)").fetchall()
        }
        if "latitude" not in existing_quantity_history_columns:
            conn.execute("ALTER TABLE quantity_asset_history ADD COLUMN latitude TEXT")
        if "longitude" not in existing_quantity_history_columns:
            conn.execute("ALTER TABLE quantity_asset_history ADD COLUMN longitude TEXT")

        for username, password, name, role in DEFAULT_USERS:
            conn.execute(
                "INSERT OR IGNORE INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
                (username, password_hash(password), name, role),
            )

        for category in DEFAULT_CATEGORIES:
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
                (category, iso_now()),
            )

        conn.execute(
            "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
            (DEFAULT_QUANTITY_ASSET_CATEGORY, iso_now()),
        )
        for job in DEFAULT_JOBS:
            conn.execute(
                "INSERT OR IGNORE INTO jobs (name, created_at) VALUES (?, ?)",
                (job, iso_now()),
            )

        count = conn.execute("SELECT COUNT(*) AS count FROM equipment").fetchone()["count"]
        if count == 0:
            now = iso_now()
            for item in DEFAULT_EQUIPMENT:
                conn.execute(
                    """
                    INSERT INTO equipment (
                      id, name, asset_tag, category, status, assigned_to,
                      site, latitude, longitude, notes, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (*item, now),
                )

        history_count = conn.execute("SELECT COUNT(*) AS count FROM asset_history").fetchone()["count"]
        if history_count == 0:
            now = iso_now()
            rows = conn.execute(
                """
                SELECT id, name, asset_tag, assigned_to, latitude, longitude
                FROM equipment
                WHERE COALESCE(assigned_to, '') <> ''
                   OR COALESCE(latitude, '') <> ''
                   OR COALESCE(longitude, '') <> ''
                """
            ).fetchall()
            for row in rows:
                conn.execute(
                    """
                    INSERT INTO asset_history (
                      equipment_id, equipment_name, asset_tag, assigned_to,
                      latitude, longitude, changed_by, changed_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["id"],
                        row["name"],
                        row["asset_tag"],
                        row["assigned_to"] or "",
                        row["latitude"] or "",
                        row["longitude"] or "",
                        "system",
                        now,
                    ),
                )


def equipment_from_row(row, include_photos=False):
    photos = []
    if include_photos and "photos" in row.keys():
        try:
            photos = json.loads(row["photos"] or "[]")
        except (TypeError, json.JSONDecodeError):
            photos = []
    has_picture = bool(row["has_picture"]) if "has_picture" in row.keys() else bool(photos)
    assigned_to = row["assigned_to"] or ""
    return {
        "id": row["id"],
        "name": row["name"],
        "assetTag": row["asset_tag"],
        "category": row["category"],
        "status": "Available" if is_available_assignment(assigned_to) else "Active",
        "assignedTo": assigned_to,
        "latitude": row["latitude"] or "",
        "longitude": row["longitude"] or "",
        "photos": photos if include_photos and isinstance(photos, list) else [],
        "hasPicture": has_picture,
        "notes": row["notes"] or "",
        "updatedAt": row["updated_at"],
    }


def history_from_row(row):
    return {
        "id": row["id"],
        "equipmentId": row["equipment_id"],
        "equipmentName": row["equipment_name"],
        "assetTag": row["asset_tag"],
        "assignedTo": row["assigned_to"] or "",
        "latitude": row["latitude"] or "",
        "longitude": row["longitude"] or "",
        "changedBy": row["changed_by"] or "",
        "changedAt": row["changed_at"],
    }


def job_audit_from_row(row):
    return {
        "id": row["id"],
        "auditDate": row["audit_date"],
        "jobName": row["job_name"],
        "itemType": row["item_type"],
        "assetNumber": row["asset_number"] or "",
        "hoseSize": row["hose_size"] or "",
        "totalHose": row["total_hose"] or "",
        "latitude": row["latitude"] or "",
        "longitude": row["longitude"] or "",
        "notes": row["notes"] or "",
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"],
    }


def saved_job_audit_from_row(row):
    item = job_audit_from_row(row)
    item.update(
        {
            "batchId": row["batch_id"],
            "status": row["status"],
            "savedBy": row["saved_by"] or "",
            "savedAt": row["saved_at"],
        }
    )
    return item


def saved_job_audit_summary_from_row(row):
    return {
        "batchId": row["batch_id"],
        "status": row["status"],
        "auditDate": row["audit_date"],
        "jobName": row["job_name"],
        "itemCount": row["item_count"],
        "savedBy": row["saved_by"] or "",
        "savedAt": row["saved_at"],
    }


def quantity_asset_from_row(row):
    categories = row["categories"] if "categories" in row.keys() else row["category"]
    category_list = [category.strip() for category in str(categories or "").split("||") if category.strip()]
    return {
        "category": ", ".join(category_list),
        "categories": category_list,
        "masterNumber": row["master_number"],
        "quantity": row["quantity"],
        "updatedAt": row["updated_at"],
    }


def quantity_asset_history_from_row(row):
    return {
        "id": row["id"],
        "category": row["category"],
        "masterNumber": row["master_number"],
        "jobName": row["job_name"] or "",
        "changeType": row["change_type"],
        "quantity": row["quantity"],
        "balanceAfter": row["balance_after"],
        "latitude": row["latitude"] or "",
        "longitude": row["longitude"] or "",
        "changedBy": row["changed_by"] or "",
        "changedAt": row["changed_at"],
    }


def load_groupme_settings():
    settings = {}
    bundled_path = ROOT / "data" / "groupme-settings.json"
    for path in (bundled_path, GROUPME_SETTINGS_PATH):
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                settings.update(json.load(handle))
    env_bot_id = os.environ.get("GROUPME_BOT_ID", "").strip()
    if env_bot_id:
        settings["botId"] = env_bot_id
    return settings


def post_groupme_message(text):
    settings = load_groupme_settings()
    bot_id = (settings.get("botId") or "").strip()
    if not bot_id:
        raise RuntimeError("GroupMe bot is not configured.")

    payload = json.dumps({"bot_id": bot_id, "text": text}).encode("utf-8")
    request = urllib.request.Request(
        "https://api.groupme.com/v3/bots/post",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status not in (200, 201, 202):
                raise RuntimeError(f"GroupMe returned status {response.status}.")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(detail or f"GroupMe returned status {exc.code}.") from exc
    except Exception as exc:
        post_groupme_message_with_curl(payload, exc)


def post_groupme_message_with_curl(payload, original_error):
    curl_path = Path("C:/Windows/System32/curl.exe")
    if not curl_path.exists():
        raise RuntimeError(str(original_error) or "Could not connect to GroupMe.") from original_error

    result = subprocess.run(
        [
            str(curl_path),
            "-sS",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
            "https://api.groupme.com/v3/bots/post",
        ],
        input=payload,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or str(original_error) or "Could not send GroupMe message.") from original_error


def groupme_keyword_response(message):
    text = str(message.get("text") or "").strip().lower()
    if not text:
        return None
    if str(message.get("sender_type") or "").strip().lower() == "bot":
        return None

    settings = load_groupme_settings()
    for item in settings.get("keywordResponses") or []:
        keyword = str(item.get("keyword") or "").strip().lower()
        response = str(item.get("response") or "").strip()
        action = str(item.get("action") or "").strip()
        if keyword and keyword in text:
            return {"response": response, "action": action}
    return None


def get_app_setting(conn, key):
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def set_app_setting(conn, key, value):
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        """,
        (key, value, iso_now()),
    )


def whatsapp_settings_from_db(conn, include_token=False):
    settings = {
        "enabled": get_app_setting(conn, WHATSAPP_ENABLED_KEY) == "1",
        "phoneNumberId": get_app_setting(conn, WHATSAPP_PHONE_NUMBER_ID_KEY) or "",
        "recipientNumber": get_app_setting(conn, WHATSAPP_RECIPIENT_KEY) or "",
        "apiVersion": get_app_setting(conn, WHATSAPP_API_VERSION_KEY) or "v23.0",
        "accessTokenConfigured": bool(get_app_setting(conn, WHATSAPP_TOKEN_KEY)),
        "verifyTokenConfigured": bool(get_app_setting(conn, WHATSAPP_VERIFY_TOKEN_KEY)),
    }
    if include_token:
        settings["accessToken"] = get_app_setting(conn, WHATSAPP_TOKEN_KEY) or ""
        settings["verifyToken"] = get_app_setting(conn, WHATSAPP_VERIFY_TOKEN_KEY) or ""
    return settings


def post_whatsapp_text(message, settings):
    url = f"https://graph.facebook.com/{settings['apiVersion']}/{settings['phoneNumberId']}/messages"
    body = json.dumps({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": settings["recipientNumber"],
        "type": "text",
        "text": {"preview_url": False, "body": message},
    }).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {settings['accessToken']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            error_message = json.loads(detail).get("error", {}).get("message")
        except json.JSONDecodeError:
            error_message = None
        raise RuntimeError(error_message or f"WhatsApp returned HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not connect to WhatsApp: {exc.reason}") from exc


def mark_inventory_finished():
    with connect() as conn:
        set_app_setting(conn, INVENTORY_FINISH_DATE_KEY, local_today())


def yard_snapshot_text_from_db(title="Big Spring Yard Snapshot"):
    with connect() as conn:
        equipment = conn.execute(
            """
            SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category, COUNT(*) AS count
            FROM equipment
            WHERE LOWER(TRIM(COALESCE(assigned_to, ''))) IN ('yard', 'big spring yard')
            GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
            ORDER BY category
            """
        ).fetchall()
        quantities = conn.execute(
            """
            SELECT master_number, category, SUM(quantity) AS quantity
            FROM quantity_asset_history
            WHERE change_type = 'Use'
              AND LOWER(TRIM(COALESCE(job_name, ''))) IN ('yard', 'big spring yard')
            GROUP BY master_number, category
            HAVING quantity > 0
            ORDER BY master_number, category
            """
        ).fetchall()

    total_assets = sum(row["count"] for row in equipment)
    total_quantity = sum(row["quantity"] for row in quantities)
    lines = [
        title,
        datetime.now(LOCAL_TZ).strftime("%b %d, %Y"),
        f"{total_assets} - Assets on Big Spring Yard",
        f"{total_quantity} - Master quantity on Big Spring Yard",
        "",
        "Equipment:",
    ]
    lines.extend([f"{row['count']} - {row['category']}" for row in equipment] or ["None"])
    lines.extend(["", "Master quantities:"])
    lines.extend(
        [f"{row['quantity']} - {row['category']} - Master #{row['master_number']}" for row in quantities]
        or ["None"]
    )
    return "\n".join(lines)


def should_send_inventory_auto_snapshot():
    today = local_today()
    now = datetime.now(LOCAL_TZ)
    if now.time() < clock_time(INVENTORY_AUTO_SEND_HOUR, INVENTORY_AUTO_SEND_MINUTE):
        return False

    with connect() as conn:
        auto_sent_date = get_app_setting(conn, INVENTORY_AUTO_SENT_DATE_KEY)
    return auto_sent_date != today


def send_inventory_auto_snapshot_if_needed():
    if not should_send_inventory_auto_snapshot():
        return

    message = yard_snapshot_text_from_db("Big Spring Yard Snapshot AUTO")
    post_groupme_message(message)
    with connect() as conn:
        set_app_setting(conn, INVENTORY_AUTO_SENT_DATE_KEY, local_today())


def inventory_auto_snapshot_loop():
    while True:
        try:
            send_inventory_auto_snapshot_if_needed()
        except Exception as exc:
            print(f"Automatic GroupMe Yard snapshot failed: {exc}")
        time.sleep(60)


def start_inventory_auto_snapshot_scheduler():
    thread = threading.Thread(target=inventory_auto_snapshot_loop, daemon=True)
    thread.start()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/whatsapp/webhook":
            return self.verify_whatsapp_webhook()
        if self.reject_tracker_viewer_request(
            allowed_paths={"/api/equipment", "/api/categories", "/api/jobs", "/api/quantity-assets", "/api/quantity-asset-history"},
            allowed_prefixes=("/api/equipment-photos/",)
        ):
            return
        if self.reject_scheduler_request(
            allowed_paths={"/api/shop-unit-types", "/api/shop-repair-codes", "/api/shop-service-schedules", "/api/shop-service-day-statuses"}
        ):
            return
        if self.reject_technician_request(
            allowed_paths={
                "/api/shop-parts", "/api/shop-unit-types", "/api/shop-repair-codes",
                "/api/shop-repair-orders", "/api/shop-service-schedules", "/api/shop-service-day-statuses",
                "/api/shop-out-of-service", "/api/shop-part-orders"
            }
        ):
            return
        if self.path == "/api/equipment":
            return self.list_equipment()
        if self.path.startswith("/api/equipment-photos/"):
            equipment_id = unquote(self.path.split("/api/equipment-photos/", 1)[1])
            return self.get_equipment_photos(equipment_id)
        if self.path == "/api/equipment.csv":
            return self.export_equipment()
        if self.path == "/api/asset-history":
            return self.list_asset_history()
        if self.path == "/api/job-audits":
            return self.list_job_audits()
        if self.path == "/api/current-audits":
            return self.list_current_audits()
        if self.path == "/api/audit-history":
            return self.list_audit_history()
        if self.path.startswith("/api/current-audits/"):
            batch_id = unquote(self.path.split("/api/current-audits/", 1)[1])
            return self.list_current_audit_detail(batch_id)
        if self.path == "/api/users":
            return self.list_users()
        if self.path == "/api/categories":
            return self.list_categories()
        if self.path == "/api/jobs":
            return self.list_jobs()
        if self.path == "/api/quantity-assets":
            return self.list_quantity_assets()
        if self.path == "/api/quantity-asset-history":
            return self.list_quantity_asset_history()
        if self.path == "/api/shop-parts":
            return self.list_shop_parts()
        if request_path == "/api/shop-part-lookup":
            return self.lookup_shop_part_online()
        if self.path == "/api/shop-unit-types":
            return self.list_shop_unit_types()
        if self.path == "/api/shop-repair-codes":
            return self.list_shop_repair_codes()
        if self.path == "/api/shop-repair-orders":
            return self.list_shop_repair_orders()
        if self.path == "/api/shop-service-schedules":
            return self.list_shop_service_schedules()
        if self.path == "/api/shop-service-day-statuses":
            return self.list_shop_service_day_statuses()
        if self.path == "/api/shop-out-of-service":
            return self.list_shop_out_of_service()
        if self.path == "/api/shop-part-orders":
            return self.list_shop_part_orders()
        if self.path == "/api/shop-whatsapp-settings":
            return self.get_shop_whatsapp_settings()
        return super().do_GET()

    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/whatsapp/webhook":
            return self.receive_whatsapp_webhook()
        if self.path != "/api/login" and self.reject_tracker_viewer_request(allowed_paths={"/api/logout"}):
            return
        if self.path not in ("/api/login", "/api/groupme/callback") and self.reject_scheduler_request(
            allowed_paths={"/api/logout", "/api/shop-service-schedules"},
        ):
            return
        if self.path not in ("/api/login", "/api/groupme/callback") and self.reject_technician_request(
            allowed_paths={"/api/logout", "/api/shop-repair-orders"},
            allowed_prefixes=("/api/shop-service-schedules/",),
        ):
            return
        if self.path == "/api/login":
            return self.login()
        if self.path == "/api/groupme/callback":
            return self.groupme_callback()
        if self.path == "/api/logout":
            return self.logout()
        if self.path == "/api/equipment":
            return self.save_equipment()
        if self.path == "/api/users":
            return self.save_user()
        if self.path == "/api/categories":
            return self.save_category()
        if self.path == "/api/jobs":
            return self.save_job()
        if self.path == "/api/quantity-assets":
            return self.save_quantity_asset()
        if self.path == "/api/quantity-assets/adjust":
            return self.adjust_quantity_asset()
        if self.path == "/api/shop-parts":
            return self.save_shop_part()
        if self.path == "/api/shop-unit-types":
            return self.save_shop_unit_type()
        if self.path == "/api/shop-repair-codes":
            return self.save_shop_repair_code()
        if self.path == "/api/shop-repair-orders":
            return self.save_shop_repair_order()
        if self.path == "/api/shop-service-schedules":
            return self.save_shop_service_schedule()
        if self.path == "/api/shop-service-day-statuses":
            return self.save_shop_service_day_status()
        if self.path == "/api/shop-out-of-service":
            return self.save_shop_out_of_service()
        if self.path == "/api/shop-part-orders":
            return self.save_shop_part_order()
        if self.path.startswith("/api/shop-part-orders/") and self.path.endswith("/received"):
            record_id = unquote(self.path.split("/api/shop-part-orders/", 1)[1].rsplit("/received", 1)[0])
            return self.receive_shop_part_order(record_id)
        if self.path.startswith("/api/shop-out-of-service/") and self.path.endswith("/status"):
            record_id = unquote(self.path.split("/api/shop-out-of-service/", 1)[1].rsplit("/status", 1)[0])
            return self.update_shop_out_of_service_status(record_id)
        if self.path == "/api/shop-whatsapp-settings":
            return self.save_shop_whatsapp_settings()
        if self.path == "/api/shop-whatsapp-settings/test":
            return self.test_shop_whatsapp_settings()
        if self.path.startswith("/api/shop-service-schedules/") and self.path.endswith("/status"):
            schedule_id = unquote(self.path.split("/api/shop-service-schedules/", 1)[1].rsplit("/status", 1)[0])
            return self.update_shop_service_schedule_status(schedule_id)
        if self.path == "/api/job-audits":
            return self.save_job_audit()
        if self.path == "/api/job-audits/save-list":
            return self.save_job_audit_list()
        if self.path == "/api/groupme/yard-inventory":
            return self.send_yard_inventory_groupme()
        if self.path.startswith("/api/current-audits/") and self.path.endswith("/status"):
            batch_id = unquote(self.path.split("/api/current-audits/", 1)[1].rsplit("/status", 1)[0])
            return self.update_current_audit_status(batch_id)
        return self.send_json({"error": "Not found."}, 404)

    def do_DELETE(self):
        if self.reject_tracker_viewer_request():
            return
        if self.reject_scheduler_request():
            return
        if self.reject_technician_request():
            return
        if self.path.startswith("/api/shop-service-schedules/"):
            schedule_id = unquote(self.path.split("/api/shop-service-schedules/", 1)[1])
            return self.delete_shop_service_schedule(schedule_id)
        if self.path.startswith("/api/equipment/"):
            equipment_id = unquote(self.path.split("/api/equipment/", 1)[1])
            return self.delete_equipment(equipment_id)
        if self.path.startswith("/api/categories/"):
            name = unquote(self.path.split("/api/categories/", 1)[1])
            return self.delete_category(name)
        if self.path.startswith("/api/jobs/"):
            name = unquote(self.path.split("/api/jobs/", 1)[1])
            return self.delete_job(name)
        if self.path.startswith("/api/quantity-assets/"):
            master_number = unquote(self.path.split("/api/quantity-assets/", 1)[1])
            return self.delete_quantity_asset(master_number)
        if self.path.startswith("/api/shop-parts/"):
            part_number = unquote(self.path.split("/api/shop-parts/", 1)[1])
            return self.delete_shop_part(part_number)
        if self.path.startswith("/api/shop-unit-types/"):
            value = unquote(self.path.split("/api/shop-unit-types/", 1)[1])
            return self.delete_shop_unit_type(value)
        if self.path.startswith("/api/shop-repair-codes/"):
            code = unquote(self.path.split("/api/shop-repair-codes/", 1)[1])
            return self.delete_shop_repair_code(code)
        return self.send_json({"error": "Not found."}, 404)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw or "{}")

    def reject_scheduler_request(self, allowed_paths=None, allowed_prefixes=()):
        user = self.current_user()
        if user is None or user["role"] != "Scheduler":
            return False
        allowed_paths = allowed_paths or set()
        if self.path in allowed_paths or any(self.path.startswith(prefix) for prefix in allowed_prefixes):
            return False
        self.send_json({"error": "Scheduler access is limited to service scheduling."}, 403)
        return True

    def reject_tracker_viewer_request(self, allowed_paths=None, allowed_prefixes=()):
        user = self.current_user()
        if user is None or user["role"] != "Tracker Viewer":
            return False
        allowed_paths = allowed_paths or set()
        if self.path in allowed_paths or any(self.path.startswith(prefix) for prefix in allowed_prefixes):
            return False
        self.send_json({"error": "Tracker Viewer access is limited to Dashboard, Equipment List, Asset Lookup, and Maps."}, 403)
        return True

    def reject_technician_request(self, allowed_paths=None, allowed_prefixes=()):
        user = self.current_user()
        if user is None or user["role"] != "Technician":
            return False
        allowed_paths = allowed_paths or set()
        if self.path in allowed_paths or any(self.path.startswith(prefix) for prefix in allowed_prefixes):
            return False
        self.send_json({"error": "Technician access is limited to assigned shop repairs."}, 403)
        return True

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, value, status=200):
        body = str(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def current_user(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        token = auth.split(" ", 1)[1].strip()
        with connect() as conn:
            return conn.execute(
                """
                SELECT users.username, users.name, users.role
                FROM sessions
                JOIN users ON users.username = sessions.username
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()

    def require_user(self):
        user = self.current_user()
        if user is None:
            self.send_json({"error": "Session expired. Please sign in again."}, 401)
        return user

    def require_admin(self):
        user = self.require_user()
        if user is None:
            return None
        if user["role"] != "Admin":
            self.send_json({"error": "Only admins can manage users."}, 403)
            return None
        return user

    def require_shop_scheduler(self):
        user = self.require_user()
        if user is None:
            return None
        if user["role"] not in ("Admin", "Scheduler"):
            self.send_json({"error": "You do not have permission to schedule shop services."}, 403)
            return None
        return user

    def require_shop_viewer(self):
        user = self.require_user()
        if user is None:
            return None
        if user["role"] not in ("Admin", "Scheduler", "Technician", "Shop Viewer"):
            self.send_json({"error": "You do not have permission to view shop schedules."}, 403)
            return None
        return user

    def require_shop_technician(self):
        user = self.require_user()
        if user is None:
            return None
        if user["role"] not in ("Admin", "Technician"):
            self.send_json({"error": "Only a technician or admin can change repair status."}, 403)
            return None
        return user

    def login(self):
        data = self.read_json()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        with connect() as conn:
            user = conn.execute(
                "SELECT username, name, role FROM users WHERE username = ? AND password_hash = ?",
                (username, password_hash(password)),
            ).fetchone()
            if user is None:
                return self.send_json({"error": "Username or password is incorrect."}, 401)

            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)",
                (token, username, iso_now()),
            )

        self.send_json({"token": token, "user": dict(user)})

    def logout(self):
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth.split(" ", 1)[1].strip()
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self.send_json({"ok": True})

    def groupme_callback(self):
        try:
            data = self.read_json()
        except Exception as exc:
            GROUPME_CALLBACK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            with GROUPME_CALLBACK_LOG_PATH.open("a", encoding="utf-8") as log:
                log.write(json.dumps({"receivedAt": iso_now(), "error": str(exc)}) + "\n")
            return self.send_json({"ok": False, "error": "Invalid callback payload."}, 400)
        match = groupme_keyword_response(data)
        log_entry = {
            "receivedAt": iso_now(),
            "name": str(data.get("name") or ""),
            "senderType": str(data.get("sender_type") or ""),
            "text": str(data.get("text") or ""),
            "matched": bool(match),
        }
        if match:
            try:
                response = match["response"]
                if match["action"] == "yard_snapshot":
                    response = yard_snapshot_text_from_db("Big Spring Yard Snapshot")
                post_groupme_message(response)
            except Exception as exc:
                log_entry["responseError"] = str(exc)
                print(f"GroupMe keyword response failed: {exc}")
        GROUPME_CALLBACK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with GROUPME_CALLBACK_LOG_PATH.open("a", encoding="utf-8") as log:
            log.write(json.dumps(log_entry) + "\n")
        self.send_json({"ok": True, "matched": bool(match)})

    def send_yard_inventory_groupme(self):
        if self.require_user() is None:
            return

        data = self.read_json()
        text = (data.get("text") or "").strip()
        if not text:
            return self.send_json({"error": "GroupMe message is empty."}, 400)

        mark_inventory_finished()

        try:
            post_groupme_message(text)
        except Exception as exc:
            return self.send_json({"error": str(exc) or "Could not send GroupMe message."}, 500)

        self.send_json({"ok": True})

    def list_equipment(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT id, name, asset_tag, category, status, assigned_to,
                       latitude, longitude, notes, updated_at,
                       CASE WHEN photos IS NOT NULL AND photos NOT IN ('', '[]') THEN 1 ELSE 0 END AS has_picture
                FROM equipment
                ORDER BY updated_at DESC, name ASC
                """
            ).fetchall()
        self.send_json([equipment_from_row(row) for row in rows])

    def get_equipment_photos(self, equipment_id):
        if self.require_user() is None:
            return
        with connect() as conn:
            row = conn.execute("SELECT * FROM equipment WHERE id = ?", (equipment_id,)).fetchone()
        if row is None:
            return self.send_json({"error": "Equipment not found."}, 404)
        record = equipment_from_row(row, include_photos=True)
        self.send_json({"id": record["id"], "photos": record["photos"]})

    def list_asset_history(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM asset_history
                ORDER BY changed_at DESC, id DESC
                LIMIT 500
                """
            ).fetchall()
        self.send_json([history_from_row(row) for row in rows])

    def list_job_audits(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM job_audits
                ORDER BY created_at DESC, id DESC
                LIMIT 500
                """
            ).fetchall()
        self.send_json([job_audit_from_row(row) for row in rows])

    def list_current_audits(self):
        if self.require_user() is None:
            return
        self.send_json(self.saved_audit_summaries(exclude_status="Job Done"))

    def list_audit_history(self):
        if self.require_user() is None:
            return
        self.send_json(self.saved_audit_summaries("Job Done"))

    def saved_audit_summaries(self, status=None, exclude_status=None):
        where_parts = []
        params = []
        if status:
            where_parts.append("status = ?")
            params.append(status)
        if exclude_status:
            where_parts.append("status <> ?")
            params.append(exclude_status)
        where = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
        with connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                  batch_id,
                  status,
                  MIN(audit_date) AS audit_date,
                  GROUP_CONCAT(DISTINCT job_name) AS job_name,
                  COUNT(*) AS item_count,
                  saved_by,
                  saved_at
                FROM saved_job_audits
                {where}
                GROUP BY batch_id, status, saved_by, saved_at
                ORDER BY saved_at DESC
                LIMIT 500
                """,
                tuple(params),
            ).fetchall()
        return [saved_job_audit_summary_from_row(row) for row in rows]

    def list_current_audit_detail(self, batch_id):
        if self.require_user() is None:
            return
        if not batch_id:
            return self.send_json({"error": "Audit id is required."}, 400)
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM saved_job_audits
                WHERE batch_id = ?
                ORDER BY id ASC
                """,
                (batch_id,),
            ).fetchall()
        self.send_json([saved_job_audit_from_row(row) for row in rows])

    def list_users(self):
        if self.require_admin() is None:
            return
        with connect() as conn:
            rows = conn.execute("SELECT username, name, role FROM users ORDER BY username ASC").fetchall()
        self.send_json([dict(row) for row in rows])

    def list_categories(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute("SELECT name FROM categories ORDER BY name ASC").fetchall()
        self.send_json([dict(row) for row in rows])

    def list_jobs(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute("SELECT name FROM jobs ORDER BY name ASC").fetchall()
        self.send_json([dict(row) for row in rows])

    def list_quantity_assets(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT
                  master_number,
                  GROUP_CONCAT(category, '||') AS categories,
                  MAX(quantity) AS quantity,
                  MAX(updated_at) AS updated_at
                FROM quantity_assets
                GROUP BY master_number
                ORDER BY master_number ASC
                """
            ).fetchall()
        self.send_json([quantity_asset_from_row(row) for row in rows])

    def list_quantity_asset_history(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM quantity_asset_history
                ORDER BY changed_at DESC, id DESC
                LIMIT 200
                """
            ).fetchall()
        self.send_json([quantity_asset_history_from_row(row) for row in rows])

    def get_shop_whatsapp_settings(self):
        if self.require_admin() is None:
            return
        with connect() as conn:
            settings = whatsapp_settings_from_db(conn)
        self.send_json(settings)

    def verify_whatsapp_webhook(self):
        query = parse_qs(urlparse(self.path).query)
        mode = (query.get("hub.mode") or [""])[0]
        token = (query.get("hub.verify_token") or [""])[0]
        challenge = (query.get("hub.challenge") or [""])[0]
        with connect() as conn:
            expected_token = get_app_setting(conn, WHATSAPP_VERIFY_TOKEN_KEY) or ""
        if mode == "subscribe" and expected_token and secrets.compare_digest(token, expected_token):
            return self.send_text(challenge)
        return self.send_text("Webhook verification failed.", 403)

    def receive_whatsapp_webhook(self):
        try:
            payload = self.read_json()
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            return self.send_json({"error": "Invalid webhook payload."}, 400)
        if payload.get("object") != "whatsapp_business_account":
            return self.send_json({"ok": True, "ignored": True})
        events = []
        for entry in payload.get("entry") or []:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                for status in value.get("statuses") or []:
                    events.append((
                        "status", str(status.get("id") or ""), str(status.get("status") or ""),
                        str(status.get("recipient_id") or ""), str(status.get("timestamp") or ""),
                    ))
                for message in value.get("messages") or []:
                    events.append((
                        "message", str(message.get("id") or ""), str(message.get("type") or ""),
                        str(message.get("from") or ""), str(message.get("timestamp") or ""),
                    ))
        payload_json = json.dumps(payload, separators=(",", ":"))
        with connect() as conn:
            if events:
                conn.executemany(
                    """
                    INSERT INTO shop_whatsapp_webhook_events (
                      event_type, message_id, message_status, recipient_number,
                      event_timestamp, payload_json, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [event + (payload_json, iso_now()) for event in events],
                )
            else:
                conn.execute(
                    "INSERT INTO shop_whatsapp_webhook_events (event_type, payload_json, received_at) VALUES ('webhook', ?, ?)",
                    (payload_json, iso_now()),
                )
        return self.send_json({"ok": True})

    def save_shop_whatsapp_settings(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        enabled = bool(data.get("enabled"))
        access_token = str(data.get("accessToken") or "").strip()
        verify_token = str(data.get("verifyToken") or "").strip()
        phone_number_id = str(data.get("phoneNumberId") or "").strip()
        recipient_number = re.sub(r"\D", "", str(data.get("recipientNumber") or ""))
        api_version = str(data.get("apiVersion") or "v23.0").strip()
        if not re.fullmatch(r"v\d{1,2}\.\d", api_version):
            return self.send_json({"error": "Enter a valid API version such as v23.0."}, 400)
        if enabled and (not phone_number_id or not recipient_number):
            return self.send_json({"error": "Phone Number ID and recipient number are required when WhatsApp is enabled."}, 400)
        with connect() as conn:
            existing_token = get_app_setting(conn, WHATSAPP_TOKEN_KEY) or ""
            existing_verify_token = get_app_setting(conn, WHATSAPP_VERIFY_TOKEN_KEY) or ""
            if enabled and not access_token and not existing_token:
                return self.send_json({"error": "Access token is required when WhatsApp is enabled."}, 400)
            set_app_setting(conn, WHATSAPP_ENABLED_KEY, "1" if enabled else "0")
            set_app_setting(conn, WHATSAPP_PHONE_NUMBER_ID_KEY, phone_number_id)
            set_app_setting(conn, WHATSAPP_RECIPIENT_KEY, recipient_number)
            set_app_setting(conn, WHATSAPP_API_VERSION_KEY, api_version)
            if access_token:
                set_app_setting(conn, WHATSAPP_TOKEN_KEY, access_token)
            if verify_token:
                set_app_setting(conn, WHATSAPP_VERIFY_TOKEN_KEY, verify_token)
        self.send_json({
            "ok": True,
            "updatedBy": user["username"],
            "accessTokenConfigured": bool(access_token or existing_token),
            "verifyTokenConfigured": bool(verify_token or existing_verify_token),
        })

    def test_shop_whatsapp_settings(self):
        if self.require_admin() is None:
            return
        with connect() as conn:
            settings = whatsapp_settings_from_db(conn, include_token=True)
        if not settings["accessToken"] or not settings["phoneNumberId"] or not settings["recipientNumber"]:
            return self.send_json({"error": "Save the access token, Phone Number ID, and recipient number before testing."}, 400)
        try:
            result = post_whatsapp_text("Sunwave Shop WhatsApp connection test.", settings)
        except RuntimeError as exc:
            return self.send_json({"error": str(exc)}, 502)
        message_id = ((result.get("messages") or [{}])[0]).get("id", "")
        self.send_json({"ok": True, "messageId": message_id})

    def list_shop_parts(self):
        if self.require_shop_viewer() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT p.part_number, p.description, p.vendor, p.price_cents, p.quantity, p.unit_type, p.unit_year,
                       p.fuel_type, p.service_code, p.updated_by, p.updated_at,
                       GROUP_CONCAT(py.unit_year, '||') AS years
                FROM shop_parts p
                LEFT JOIN shop_part_years py ON py.part_number = p.part_number
                GROUP BY p.part_number
                ORDER BY p.part_number COLLATE NOCASE
                """
            ).fetchall()
        self.send_json([
            {
                "partNumber": row["part_number"],
                "description": row["description"] or "",
                "vendor": row["vendor"] or "Unspecified",
                "price": f"{int(row['price_cents']) / 100:.2f}",
                "quantity": int(row["quantity"]),
                "unitType": row["unit_type"] or "",
                "year": row["unit_year"] or "",
                "years": sorted((row["years"] or "").split("||"), reverse=True) if row["years"] else [],
                "fuelType": row["fuel_type"] or "",
                "serviceCode": row["service_code"] or "",
                "updatedBy": row["updated_by"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ])

    def lookup_shop_part_online(self):
        if self.require_admin() is None:
            return
        query = str(parse_qs(urlparse(self.path).query).get("q", [""])[0]).strip()
        if not query:
            return self.send_json({"error": "Enter a barcode or part number."}, 400)
        compact = re.sub(r"[\s-]", "", query)
        if compact.isdigit() and 7 <= len(compact) <= 14:
            endpoint = "https://api.upcitemdb.com/prod/trial/lookup?" + urlencode({"upc": compact})
            lookup_type = "barcode"
        else:
            endpoint = "https://api.upcitemdb.com/prod/trial/search?" + urlencode({"s": query, "type": "product"})
            lookup_type = "part number"
        request = urllib.request.Request(endpoint, headers={"Accept": "application/json", "User-Agent": "Sunwave-Shop/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return self.send_json({"query": query, "source": "UPCitemdb", "results": []})
            if exc.code == 429:
                return self.send_json({"error": "The online lookup limit was reached. Try again later or enter the part manually."}, 429)
            return self.send_json({"error": f"Online lookup returned HTTP {exc.code}."}, 502)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            return self.send_json({"error": f"Online lookup is unavailable: {exc}"}, 502)

        results = []
        seen = set()
        for item in (payload.get("items") or [])[:10]:
            title = str(item.get("title") or "").strip()
            if not title or title.casefold() in seen:
                continue
            seen.add(title.casefold())
            offers = [offer for offer in (item.get("offers") or []) if isinstance(offer, dict)]
            offer_prices = []
            for offer in offers:
                try:
                    price = Decimal(str(offer.get("price") or "0"))
                    if price > 0:
                        offer_prices.append(price)
                except InvalidOperation:
                    pass
            try:
                recorded_price = Decimal(str(item.get("lowest_recorded_price") or "0"))
            except InvalidOperation:
                recorded_price = Decimal("0")
            best_price = min(offer_prices) if offer_prices else recorded_price
            vendor = str(item.get("brand") or "").strip()
            if not vendor and offers:
                vendor = str(offers[0].get("merchant") or offers[0].get("domain") or "").strip()
            results.append({
                "partNumber": query,
                "barcode": str(item.get("upc") or item.get("ean") or compact if lookup_type == "barcode" else ""),
                "description": title,
                "vendor": vendor or "Unspecified",
                "price": f"{best_price:.2f}" if best_price > 0 else "",
                "category": str(item.get("category") or "").strip(),
                "imageUrl": str((item.get("images") or [""])[0] or ""),
            })
            if len(results) == 5:
                break
        self.send_json({"query": query, "source": "UPCitemdb", "lookupType": lookup_type, "results": results})

    def save_shop_part(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        part_number = str(data.get("partNumber") or "").strip()
        description = str(data.get("description") or "").strip()
        vendor = str(data.get("vendor") or "").strip()
        unit_type = str(data.get("unitType") or "").strip()
        raw_years = data.get("years", [])
        unit_years = sorted({str(year or "").strip() for year in raw_years if str(year or "").strip()}, reverse=True) if isinstance(raw_years, list) else []
        unit_year = unit_years[0] if unit_years else ""
        fuel_type = str(data.get("fuelType") or "").strip()
        service_code = str(data.get("serviceCode") or "").strip()
        replace_quantity = data.get("replaceQuantity") is True
        try:
            price = Decimal(str(data.get("price") or "")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            price_cents = int(price * 100)
        except (InvalidOperation, TypeError, ValueError):
            return self.send_json({"error": "Enter a valid price."}, 400)
        try:
            quantity = int(data.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0
        if not part_number:
            return self.send_json({"error": "Part number is required."}, 400)
        if not description:
            return self.send_json({"error": "Part description is required."}, 400)
        if not vendor:
            return self.send_json({"error": "Vendor is required."}, 400)
        if not unit_type or not unit_years:
            return self.send_json({"error": "Select one or more years and a unit type."}, 400)
        if unit_type.casefold() == "truck":
            if fuel_type not in ("Gasoline", "Diesel", "Diesel and Gasoline"):
                return self.send_json({"error": "Select Diesel, Gasoline, or Diesel and Gasoline for Truck parts."}, 400)
        else:
            fuel_type = ""
        if not service_code:
            return self.send_json({"error": "Select a service code."}, 400)
        if price_cents < 0:
            return self.send_json({"error": "Price cannot be negative."}, 400)
        if quantity < 0 or (not replace_quantity and quantity == 0):
            return self.send_json({"error": "Quantity must be zero or greater when updating, and greater than zero when adding."}, 400)

        now = iso_now()
        with connect() as conn:
            existing_part = conn.execute(
                "SELECT description, quantity FROM shop_parts WHERE part_number = ? COLLATE NOCASE",
                (part_number,),
            ).fetchone()
            was_existing = existing_part is not None
            previous_quantity = int(existing_part["quantity"]) if existing_part is not None else 0
            if (
                existing_part is not None
                and not replace_quantity
                and existing_part["description"].strip().casefold() != description.casefold()
            ):
                return self.send_json({
                    "error": "This Part Number already exists with a different description. Edit the existing part instead."
                }, 409)
            placeholders = ",".join("?" for _ in unit_years)
            matching_years = conn.execute(
                f"SELECT COUNT(DISTINCT unit_year) FROM shop_unit_types WHERE unit_type = ? COLLATE NOCASE AND unit_year IN ({placeholders})",
                (unit_type, *unit_years),
            ).fetchone()[0]
            if matching_years == 0:
                return self.send_json({"error": "Select a unit type saved for one of the selected years."}, 400)
            code_exists = conn.execute(
                "SELECT 1 FROM shop_repair_codes WHERE code = ? COLLATE NOCASE",
                (service_code,),
            ).fetchone()
            if code_exists is None:
                return self.send_json({"error": "Select an existing service code."}, 400)
            if replace_quantity:
                cursor = conn.execute(
                    """
                    UPDATE shop_parts
                    SET description = ?, vendor = ?, price_cents = ?, quantity = ?, unit_type = ?, unit_year = ?, fuel_type = ?, service_code = ?, updated_by = ?, updated_at = ?
                    WHERE part_number = ? COLLATE NOCASE
                    """,
                    (description, vendor, price_cents, quantity, unit_type, unit_year, fuel_type, service_code, user["username"], now, part_number),
                )
                if cursor.rowcount == 0:
                    return self.send_json({"error": "Part was not found. Refresh the list and try again."}, 404)
            else:
                conn.execute(
                    """
                    INSERT INTO shop_parts (part_number, description, vendor, price_cents, quantity, unit_type, unit_year, fuel_type, service_code, updated_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(part_number) DO UPDATE SET
                      price_cents = excluded.price_cents,
                      description = excluded.description,
                      vendor = excluded.vendor,
                      quantity = shop_parts.quantity + excluded.quantity,
                      unit_type = excluded.unit_type,
                      unit_year = excluded.unit_year,
                      fuel_type = excluded.fuel_type,
                      service_code = excluded.service_code,
                      updated_by = excluded.updated_by,
                      updated_at = excluded.updated_at
                    """,
                    (part_number, description, vendor, price_cents, quantity, unit_type, unit_year, fuel_type, service_code, user["username"], now),
                )
            conn.execute("DELETE FROM shop_part_years WHERE part_number = ? COLLATE NOCASE", (part_number,))
            conn.executemany(
                "INSERT INTO shop_part_years (part_number, unit_year) VALUES (?, ?)",
                [(part_number, year) for year in unit_years],
            )
            row = conn.execute(
                "SELECT part_number, description, vendor, price_cents, quantity, unit_type, unit_year, fuel_type, service_code, updated_by, updated_at FROM shop_parts WHERE part_number = ? COLLATE NOCASE",
                (part_number,),
            ).fetchone()
        self.send_json({
            "partNumber": row["part_number"],
            "description": row["description"] or "",
            "vendor": row["vendor"] or "Unspecified",
            "vendor": row["vendor"] or "Unspecified",
            "price": f"{int(row['price_cents']) / 100:.2f}",
            "quantity": int(row["quantity"]),
            "unitType": row["unit_type"] or "",
            "year": row["unit_year"] or "",
            "years": unit_years,
            "fuelType": row["fuel_type"] or "",
            "serviceCode": row["service_code"] or "",
            "updatedBy": row["updated_by"],
            "updatedAt": row["updated_at"],
            "wasExisting": was_existing,
            "previousQuantity": previous_quantity,
            "quantityAdded": 0 if replace_quantity else quantity,
        })

    def delete_shop_part(self, part_number):
        if self.require_admin() is None:
            return
        part_number = str(part_number or "").strip()
        if not part_number:
            return self.send_json({"error": "Part number is required."}, 400)
        with connect() as conn:
            used_part = conn.execute(
                "SELECT repair_order_id FROM shop_repair_order_parts WHERE part_number = ? COLLATE NOCASE LIMIT 1",
                (part_number,),
            ).fetchone()
            if used_part:
                return self.send_json(
                    {"error": f"Part {part_number} is used on repair order #{used_part['repair_order_id']} and cannot be deleted."},
                    409,
                )
            cursor = conn.execute(
                "DELETE FROM shop_parts WHERE part_number = ? COLLATE NOCASE",
                (part_number,),
            )
            if cursor.rowcount == 0:
                return self.send_json({"error": "Part was not found."}, 404)
        self.send_json({"ok": True})

    def list_shop_unit_types(self):
        if self.require_shop_viewer() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                "SELECT id, unit_type, unit_year, make, fuel_type, model, asset_number, vin, tire_size, created_by, created_at FROM shop_unit_types ORDER BY asset_number COLLATE NOCASE"
            ).fetchall()
        self.send_json([
            {
                "id": int(row["id"]),
                "unitType": row["unit_type"],
                "year": row["unit_year"],
                "make": row["make"],
                "fuelType": row["fuel_type"],
                "model": row["model"],
                "assetNumber": row["asset_number"],
                "vin": row["vin"],
                "tireSize": row["tire_size"] or "",
                "createdBy": row["created_by"],
                "createdAt": row["created_at"],
            }
            for row in rows
        ])

    def save_shop_unit_type(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        unit_type = str(data.get("unitType") or "").strip()
        unit_year = str(data.get("year") or "").strip()
        make = str(data.get("make") or "").strip()
        fuel_type = str(data.get("fuelType") or "").strip()
        model = str(data.get("model") or "").strip()
        asset_number = str(data.get("assetNumber") or "").strip()
        vin = str(data.get("vin") or "").strip()
        tire_size = str(data.get("tireSize") or "").strip()
        if not asset_number:
            return self.send_json({"error": "Asset number is required."}, 400)
        if not unit_type:
            return self.send_json({"error": "Unit type is required."}, 400)
        if not make:
            return self.send_json({"error": "Make is required."}, 400)
        if not fuel_type:
            return self.send_json({"error": "Fuel type is required."}, 400)
        if not unit_year.isdigit() or len(unit_year) != 4:
            return self.send_json({"error": "Enter a four-digit year."}, 400)
        if not model or not vin or not tire_size:
            return self.send_json({"error": "Model, VIN, and tire size are required."}, 400)
        with connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO shop_unit_types (
                      unit_type, unit_year, make, fuel_type, model, asset_number, vin, tire_size, created_by, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(asset_number) DO UPDATE SET
                      unit_type = excluded.unit_type,
                      unit_year = excluded.unit_year,
                      make = excluded.make,
                      fuel_type = excluded.fuel_type,
                      model = excluded.model,
                      vin = excluded.vin,
                      tire_size = excluded.tire_size,
                      created_by = excluded.created_by,
                      created_at = excluded.created_at
                    """,
                    (unit_type, unit_year, make, fuel_type, model, asset_number, vin, tire_size, user["username"], iso_now()),
                )
            except sqlite3.IntegrityError:
                return self.send_json({"error": "That asset number or VIN is already assigned."}, 409)
        self.send_json({"ok": True})

    def delete_shop_unit_type(self, value):
        if self.require_admin() is None:
            return
        try:
            unit_id = int(value)
        except (TypeError, ValueError):
            return self.send_json({"error": "Unit was not found."}, 400)
        with connect() as conn:
            unit = conn.execute(
                "SELECT unit_type, unit_year FROM shop_unit_types WHERE id = ?",
                (unit_id,),
            ).fetchone()
            if unit is None:
                return self.send_json({"error": "Unit was not found."}, 404)
            in_use = conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM shop_parts p
                JOIN shop_part_years py ON py.part_number = p.part_number
                WHERE p.unit_type = ? COLLATE NOCASE AND py.unit_year = ?
                """,
                (unit["unit_type"], unit["unit_year"]),
            ).fetchone()["count"]
            matching_units = conn.execute(
                "SELECT COUNT(*) AS count FROM shop_unit_types WHERE unit_type = ? COLLATE NOCASE AND unit_year = ?",
                (unit["unit_type"], unit["unit_year"]),
            ).fetchone()["count"]
            if in_use and matching_units <= 1:
                return self.send_json({"error": "This unit type is assigned to parts and cannot be deleted."}, 409)
            conn.execute("DELETE FROM shop_unit_types WHERE id = ?", (unit_id,))
        self.send_json({"ok": True})

    def list_shop_repair_codes(self):
        user = self.require_shop_viewer()
        if user is None:
            return
        with connect() as conn:
            rows = conn.execute(
                "SELECT code, description, labor_minutes, requires_position, updated_by, updated_at FROM shop_repair_codes ORDER BY code COLLATE NOCASE"
            ).fetchall()
            options_by_code = {}
            for option in conn.execute(
                "SELECT code, option_name, labor_minutes FROM shop_repair_code_options ORDER BY code COLLATE NOCASE, option_name COLLATE NOCASE"
            ).fetchall():
                option_payload = {"name": option["option_name"]}
                if user["role"] == "Admin":
                    option_payload["laborHours"] = None if option["labor_minutes"] is None else f"{int(option['labor_minutes']) / 60:.2f}"
                options_by_code.setdefault(option["code"].casefold(), []).append(option_payload)
        self.send_json([
            {
                "code": row["code"],
                "description": row["description"],
                "requiresPosition": bool(row["requires_position"]),
                "options": options_by_code.get(row["code"].casefold(), []),
                **({"laborHours": f"{int(row['labor_minutes']) / 60:.2f}"} if user["role"] == "Admin" else {}),
                "updatedBy": row["updated_by"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ])

    def save_shop_repair_code(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        code = str(data.get("code") or "").strip()
        description = str(data.get("description") or "").strip()
        vendor = str(data.get("vendor") or "").strip()
        requires_position = 1 if data.get("requiresPosition") else 0
        raw_options = data.get("options", [])
        if not isinstance(raw_options, list):
            raw_options = []
        repair_options = []
        seen_option_names = set()
        for raw_option in raw_options:
            if not isinstance(raw_option, dict):
                continue
            option_name = str(raw_option.get("name") or "").strip()
            raw_option_labor = str(raw_option.get("laborHours") or "").strip()
            if not option_name:
                continue
            option_key = option_name.casefold()
            if option_key in seen_option_names:
                return self.send_json({"error": f"Checkbox option {option_name} is duplicated."}, 400)
            seen_option_names.add(option_key)
            option_labor_minutes = None
            if raw_option_labor:
                try:
                    option_labor_hours = Decimal(raw_option_labor)
                    option_labor_minutes = int((option_labor_hours * 60).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
                except (InvalidOperation, TypeError, ValueError):
                    return self.send_json({"error": f"Enter valid labor hours for {option_name}."}, 400)
                if not option_labor_hours.is_finite() or option_labor_hours < 0:
                    return self.send_json({"error": f"Labor hours for {option_name} cannot be negative."}, 400)
            repair_options.append((option_name, option_labor_minutes))
        try:
            labor_hours = Decimal(str(data.get("laborHours") or "0"))
            labor_minutes = int((labor_hours * 60).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, TypeError, ValueError):
            return self.send_json({"error": "Enter valid labor hours."}, 400)
        if not code or not description:
            return self.send_json({"error": "Code and description are required."}, 400)
        if not labor_hours.is_finite() or labor_hours < 0:
            return self.send_json({"error": "Labor hours cannot be negative."}, 400)
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO shop_repair_codes (code, description, labor_minutes, requires_position, updated_by, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(code) DO UPDATE SET
                  description = excluded.description,
                  labor_minutes = excluded.labor_minutes,
                  requires_position = excluded.requires_position,
                  updated_by = excluded.updated_by,
                  updated_at = excluded.updated_at
                """,
                (code, description, labor_minutes, requires_position, user["username"], iso_now()),
            )
            conn.execute("DELETE FROM shop_repair_code_options WHERE code = ? COLLATE NOCASE", (code,))
            conn.executemany(
                "INSERT INTO shop_repair_code_options (code, option_name, labor_minutes) VALUES (?, ?, ?)",
                [(code, option_name, option_labor_minutes) for option_name, option_labor_minutes in repair_options],
            )
        self.send_json({"ok": True})

    def delete_shop_repair_code(self, code):
        if self.require_admin() is None:
            return
        code = str(code or "").strip()
        if not code:
            return self.send_json({"error": "Repair code is required."}, 400)
        with connect() as conn:
            linked_part = conn.execute(
                "SELECT part_number FROM shop_parts WHERE service_code = ? COLLATE NOCASE LIMIT 1",
                (code,),
            ).fetchone()
            if linked_part:
                return self.send_json(
                    {"error": f"Repair code {code} is assigned to part {linked_part['part_number']} and cannot be deleted."},
                    409,
                )
            conn.execute("DELETE FROM shop_repair_code_options WHERE code = ? COLLATE NOCASE", (code,))
            conn.execute("DELETE FROM shop_repair_codes WHERE code = ? COLLATE NOCASE", (code,))
        self.send_json({"ok": True})

    def list_shop_repair_orders(self):
        user = self.require_shop_viewer()
        if user is None:
            return
        with connect() as conn:
            orders = conn.execute(
                "SELECT * FROM shop_repair_orders ORDER BY order_date DESC, id DESC"
            ).fetchall()
            result = []
            for order in orders:
                schedule = None
                if (order["source"] or "") == "Scheduled Service" and order["source_reference_id"] is not None:
                    schedule = conn.execute(
                        "SELECT original_scheduled_date, scheduled_date, working_started_at, completed_at FROM shop_service_schedules WHERE id = ?",
                        (order["source_reference_id"],),
                    ).fetchone()
                if schedule is None:
                    schedule = conn.execute(
                        "SELECT original_scheduled_date, scheduled_date, working_started_at, completed_at FROM shop_service_schedules WHERE repair_order_id = ?",
                        (order["id"],),
                    ).fetchone()
                codes = conn.execute(
                    "SELECT code, description, labor_minutes, positions FROM shop_repair_order_codes WHERE repair_order_id = ? ORDER BY code COLLATE NOCASE",
                    (order["id"],),
                ).fetchall()
                selected_options = conn.execute(
                    "SELECT code, option_name, labor_minutes FROM shop_repair_order_code_options WHERE repair_order_id = ? ORDER BY code COLLATE NOCASE, option_name COLLATE NOCASE",
                    (order["id"],),
                ).fetchall()
                selected_options_by_code = {}
                for option in selected_options:
                    option_payload = {"name": option["option_name"]}
                    if user["role"] == "Admin":
                        option_payload["laborHours"] = None if option["labor_minutes"] is None else f"{int(option['labor_minutes']) / 60:.2f}"
                    selected_options_by_code.setdefault(option["code"].casefold(), []).append(option_payload)
                parts = conn.execute(
                    "SELECT part_number, description, vendor, quantity, unit_price_cents FROM shop_repair_order_parts WHERE repair_order_id = ? ORDER BY part_number COLLATE NOCASE",
                    (order["id"],),
                ).fetchall()
                parts_total_cents = sum(int(part["quantity"]) * int(part["unit_price_cents"]) for part in parts)
                repair_cost_cents = int(order["additional_cost_cents"] or 0)
                result.append({
                    "id": int(order["id"]),
                    "date": order["order_date"],
                    "location": order["location"],
                    "technicianName": order["technician_name"],
                    "driverName": order["driver_name"] or "",
                    "assetNumber": order["asset_number"],
                    "assetMileage": order["asset_mileage"],
                    "assetHours": order["asset_hours"],
                    "status": order["status"] or "Completed",
                    "jobDescription": order["job_description"],
                    "repairCodes": [
                        {
                            "code": code["code"],
                            "description": code["description"],
                            **({"laborHours": f"{int(code['labor_minutes']) / 60:.2f}"} if user["role"] == "Admin" else {}),
                            "positions": [value for value in (code["positions"] or "").split("|") if value],
                            "options": selected_options_by_code.get(code["code"].casefold(), []),
                        }
                        for code in codes
                    ],
                    "partsUsed": [
                        {
                            "partNumber": part["part_number"],
                            "description": part["description"] or "",
                            "vendor": part["vendor"] or "Unspecified",
                            "quantity": int(part["quantity"]),
                            "unitPrice": f"{int(part['unit_price_cents']) / 100:.2f}",
                            "totalPrice": f"{int(part['quantity']) * int(part['unit_price_cents']) / 100:.2f}",
                        }
                        for part in parts
                    ],
                    "partsTotal": f"{parts_total_cents / 100:.2f}",
                    "repairCost": f"{repair_cost_cents / 100:.2f}",
                    "totalCost": f"{(parts_total_cents + repair_cost_cents) / 100:.2f}",
                    "source": order["source"] or "Repair Order",
                    "sourceReferenceId": int(order["source_reference_id"]) if order["source_reference_id"] is not None else None,
                    "createdAt": order["created_at"],
                    "originalScheduledDate": (schedule["original_scheduled_date"] or schedule["scheduled_date"]) if schedule else "",
                    "currentScheduledDate": schedule["scheduled_date"] if schedule else "",
                    "workingStartedDate": (schedule["working_started_at"] or "")[:10] if schedule else "",
                    "completedDate": (schedule["completed_at"] or "")[:10] if schedule else "",
                })
        self.send_json(result)

    def save_shop_repair_order(self):
        data = self.read_json()
        raw_schedule_id = data.get("scheduleId")
        try:
            schedule_id = int(raw_schedule_id) if raw_schedule_id not in (None, "") else None
        except (TypeError, ValueError):
            return self.send_json({"error": "Scheduled repair was not found."}, 400)
        user = self.require_shop_technician()
        if user is None:
            return
        order_date = str(data.get("date") or "").strip()
        location = str(data.get("location") or "").strip()
        requested_technician_name = str(data.get("technicianName") or "").strip()
        technician_name = requested_technician_name if user["role"] == "Admin" and requested_technician_name else user["name"]
        driver_name = str(data.get("driverName") or "").strip()
        asset_number = str(data.get("assetNumber") or "").strip()
        job_description = str(data.get("jobDescription") or "").strip()
        raw_codes = data.get("repairCodes", [])
        if not isinstance(raw_codes, list):
            raw_codes = []
        requested_codes = sorted({str(code or "").strip() for code in raw_codes if str(code or "").strip()})
        raw_positions = data.get("repairCodePositions", {})
        if not isinstance(raw_positions, dict):
            raw_positions = {}
        allowed_positions = {"Front Left", "Front Right", "Rear Left", "Rear Right"}
        requested_positions = {
            str(code): [str(value) for value in values if str(value) in allowed_positions]
            for code, values in raw_positions.items()
            if isinstance(values, list)
        }
        raw_options = data.get("repairCodeOptions", {})
        if not isinstance(raw_options, dict):
            raw_options = {}
        requested_options = {
            str(code): [str(value).strip() for value in values if str(value).strip()]
            for code, values in raw_options.items()
            if isinstance(values, list)
        }
        raw_parts = data.get("partsUsed", [])
        if not isinstance(raw_parts, list):
            raw_parts = []
        requested_parts = {}
        for part in raw_parts:
            if not isinstance(part, dict):
                continue
            part_number = str(part.get("partNumber") or "").strip()
            try:
                part_quantity = int(part.get("quantity") or 0)
            except (TypeError, ValueError):
                return self.send_json({"error": "Part quantities must be whole numbers."}, 400)
            if part_number and part_quantity > 0:
                requested_parts[part_number] = requested_parts.get(part_number, 0) + part_quantity
        try:
            datetime.strptime(order_date, "%Y-%m-%d")
        except ValueError:
            return self.send_json({"error": "Enter a valid repair order date."}, 400)
        if not location or not driver_name or not asset_number or not job_description:
            return self.send_json({"error": "Location, driver name, asset number, and job description are required."}, 400)
        if not requested_codes:
            return self.send_json({"error": "Select at least one repair code."}, 400)
        try:
            mileage = Decimal(str(data.get("assetMileage") or "0"))
            hours = Decimal(str(data.get("assetHours") or "0"))
        except InvalidOperation:
            return self.send_json({"error": "Mileage and hours must be valid numbers."}, 400)
        if not mileage.is_finite() or not hours.is_finite() or mileage < 0 or hours < 0:
            return self.send_json({"error": "Mileage and hours cannot be negative."}, 400)

        with connect() as conn:
            schedule = None
            if schedule_id is not None:
                schedule = conn.execute(
                    "SELECT * FROM shop_service_schedules WHERE id = ?",
                    (schedule_id,),
                ).fetchone()
                if schedule is None:
                    return self.send_json({"error": "Scheduled repair was not found."}, 404)
                if schedule["status"] != "Working on it":
                    return self.send_json({"error": "Start the scheduled repair before saving its repair order."}, 409)
                if schedule["repair_order_id"] is not None:
                    return self.send_json({"error": "This scheduled repair already has a saved repair order."}, 409)
                if user["role"] == "Technician" and schedule["technician_username"] != user["username"]:
                    return self.send_json({"error": "This scheduled repair is assigned to another technician."}, 403)
                if schedule["asset_number"].strip().casefold() != asset_number.casefold():
                    return self.send_json({"error": "The repair order asset must match the scheduled asset."}, 400)
            asset = conn.execute(
                "SELECT 1 FROM shop_unit_types WHERE asset_number = ? COLLATE NOCASE",
                (asset_number,),
            ).fetchone()
            if asset is None:
                return self.send_json({"error": "Select a registered asset number."}, 400)
            placeholders = ",".join("?" for _ in requested_codes)
            code_rows = conn.execute(
                f"SELECT code, description, labor_minutes, requires_position FROM shop_repair_codes WHERE code IN ({placeholders})",
                requested_codes,
            ).fetchall()
            if len(code_rows) != len(requested_codes):
                return self.send_json({"error": "One or more repair codes are not available."}, 400)
            for row in code_rows:
                if row["requires_position"] and not requested_positions.get(row["code"]):
                    return self.send_json({"error": f"Select at least one asset position for repair code {row['code']}."}, 400)
                available_options = conn.execute(
                    "SELECT option_name, labor_minutes FROM shop_repair_code_options WHERE code = ? COLLATE NOCASE",
                    (row["code"],),
                ).fetchall()
                if available_options:
                    selected_names = requested_options.get(row["code"], [])
                    allowed_names = {option["option_name"] for option in available_options}
                    if not selected_names:
                        return self.send_json({"error": f"Select at least one service option for repair code {row['code']}."}, 400)
                    if any(name not in allowed_names for name in selected_names):
                        return self.send_json({"error": f"One or more service options for repair code {row['code']} are not available."}, 400)
            part_rows = []
            for part_number, part_quantity in requested_parts.items():
                part = conn.execute(
                    "SELECT part_number, description, vendor, price_cents, quantity, service_code FROM shop_parts WHERE part_number = ? COLLATE NOCASE",
                    (part_number,),
                ).fetchone()
                if part is None:
                    return self.send_json({"error": f"Part {part_number} is not available."}, 400)
                if str(part["service_code"] or "").lower() not in {code.lower() for code in requested_codes}:
                    return self.send_json({"error": f"Part {part['part_number']} is not associated with a selected repair code."}, 400)
                if part_quantity > int(part["quantity"]):
                    return self.send_json({"error": f"Only {int(part['quantity'])} of part {part['part_number']} are available."}, 400)
                part_rows.append((part["part_number"], part["description"] or "", part["vendor"] or "Unspecified", part_quantity, int(part["price_cents"])))
            order_status = "Working on it" if schedule is not None else "Completed"
            cursor = conn.execute(
                """
                INSERT INTO shop_repair_orders (
                  order_date, location, technician_username, technician_name,
                  driver_name, asset_number, asset_mileage, asset_hours, job_description, status,
                  source, source_reference_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    order_date, location, user["username"], technician_name, driver_name, asset_number,
                    format(mileage, "f"), format(hours, "f"), job_description, order_status,
                    "Scheduled Service" if schedule is not None else "Repair Order", schedule_id, iso_now()
                ),
            )
            order_id = cursor.lastrowid
            conn.executemany(
                "INSERT INTO shop_repair_order_codes (repair_order_id, code, description, labor_minutes, positions) VALUES (?, ?, ?, ?, ?)",
                [(order_id, row["code"], row["description"], row["labor_minutes"], "|".join(requested_positions.get(row["code"], []))) for row in code_rows],
            )
            for row in code_rows:
                if not requested_options.get(row["code"]):
                    continue
                option_rows = conn.execute(
                    "SELECT option_name, labor_minutes FROM shop_repair_code_options WHERE code = ? COLLATE NOCASE",
                    (row["code"],),
                ).fetchall()
                option_labor = {option["option_name"]: option["labor_minutes"] for option in option_rows}
                conn.executemany(
                    "INSERT INTO shop_repair_order_code_options (repair_order_id, code, option_name, labor_minutes) VALUES (?, ?, ?, ?)",
                    [(order_id, row["code"], name, option_labor[name]) for name in requested_options[row["code"]]],
                )
            for part_number, description, vendor, part_quantity, unit_price_cents in part_rows:
                conn.execute(
                    "UPDATE shop_parts SET quantity = quantity - ?, updated_by = ?, updated_at = ? WHERE part_number = ? COLLATE NOCASE",
                    (part_quantity, user["username"], iso_now(), part_number),
                )
                conn.execute(
                    "INSERT INTO shop_repair_order_parts (repair_order_id, part_number, description, vendor, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)",
                    (order_id, part_number, description, vendor, part_quantity, unit_price_cents),
                )
            if schedule is not None:
                conn.execute(
                    """
                    UPDATE shop_service_schedules
                    SET status = 'Working on it', repair_order_id = ?, technician_username = ?, technician_name = ?,
                        working_started_at = CASE WHEN working_started_at = '' THEN ? ELSE working_started_at END,
                        updated_by = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (order_id, user["username"], technician_name, iso_now(), user["username"], iso_now(), schedule_id),
                )
        self.send_json({"ok": True, "id": order_id, "scheduleId": schedule_id, "status": order_status})

    def shop_part_order_payload(self, row):
        return {
            "id": int(row["id"]),
            "partNumber": row["part_number"],
            "description": row["description"] or "",
            "vendor": row["vendor"] or "Unspecified",
            "quantity": int(row["quantity"]),
            "purchaseType": row["purchase_type"] or "Unit Part",
            "assetNumber": row["asset_number"] or "",
            "unitPrice": f"{int(row['unit_price_cents'] or 0) / 100:.2f}",
            "totalPrice": f"{int(row['unit_price_cents'] or 0) * int(row['quantity']) / 100:.2f}",
            "orderDate": row["order_date"],
            "pickupDate": row["pickup_date"] or "",
            "status": row["status"],
            "createdBy": row["created_by"],
            "updatedBy": row["updated_by"],
        }

    def add_received_order_to_inventory(self, conn, row, username):
        if row["purchase_type"] not in ("Unit Part", "Tire Inventory") or not (row["part_number"] or "").strip():
            return {"inventoryUpdated": False}
        part = conn.execute(
            "SELECT quantity FROM shop_parts WHERE part_number = ? COLLATE NOCASE",
            (row["part_number"],),
        ).fetchone()
        if part is None:
            return {"inventoryUpdated": False, "inventoryPartMissing": True}
        previous_quantity = int(part["quantity"])
        added_quantity = int(row["quantity"])
        conn.execute(
            "UPDATE shop_parts SET quantity = quantity + ?, updated_by = ?, updated_at = ? WHERE part_number = ? COLLATE NOCASE",
            (added_quantity, username, iso_now(), row["part_number"]),
        )
        return {
            "inventoryUpdated": True,
            "inventoryPreviousQuantity": previous_quantity,
            "inventoryAddedQuantity": added_quantity,
            "inventoryQuantity": previous_quantity + added_quantity,
        }

    def list_shop_part_orders(self):
        if self.require_shop_viewer() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                "SELECT * FROM shop_part_orders ORDER BY CASE status WHEN 'Waiting for Order' THEN 0 ELSE 1 END, pickup_date DESC, order_date DESC, id DESC"
            ).fetchall()
        self.send_json([self.shop_part_order_payload(row) for row in rows])

    def save_shop_part_order(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        part_number = str(data.get("partNumber") or "").strip()
        description = str(data.get("description") or "").strip()
        vendor = str(data.get("vendor") or "").strip()
        purchase_type = str(data.get("purchaseType") or "Unit Part").strip()
        asset_number = str(data.get("assetNumber") or "").strip()
        order_date = str(data.get("orderDate") or local_today()).strip()
        pickup_date = str(data.get("pickupDate") or "").strip()
        status = "Order Received" if data.get("pickedUp") is True else "Waiting for Order"
        try:
            quantity = int(data.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0
        try:
            unit_price = Decimal(str(data.get("unitPrice") or "0")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            unit_price_cents = int(unit_price * 100)
        except (InvalidOperation, TypeError, ValueError):
            return self.send_json({"error": "Enter a valid price."}, 400)
        if not unit_price.is_finite() or unit_price < 0:
            return self.send_json({"error": "Price cannot be negative."}, 400)
        if purchase_type not in ("Unit Part", "Job Material", "Tire Inventory"):
            return self.send_json({"error": "Select whether this is for a unit or material for jobs."}, 400)
        if not description or not vendor or quantity < 1 or (purchase_type == "Unit Part" and (not part_number or not asset_number)) or (purchase_type == "Tire Inventory" and not part_number):
            return self.send_json({"error": "Enter the vendor, description, and quantity. Unit parts also require a part number and unit."}, 400)
        if purchase_type == "Job Material":
            part_number = ""
            asset_number = ""
        elif purchase_type == "Tire Inventory":
            asset_number = ""
        try:
            datetime.strptime(order_date, "%Y-%m-%d")
        except ValueError:
            return self.send_json({"error": "Select a valid order date."}, 400)
        if status == "Order Received":
            try:
                datetime.strptime(pickup_date, "%Y-%m-%d")
            except ValueError:
                return self.send_json({"error": "Select the pickup date for the received part."}, 400)
        else:
            pickup_date = ""
        now = iso_now()
        with connect() as conn:
            if purchase_type == "Unit Part":
                unit = conn.execute(
                    "SELECT 1 FROM shop_unit_types WHERE asset_number = ? COLLATE NOCASE",
                    (asset_number,),
                ).fetchone()
                if unit is None:
                    return self.send_json({"error": "Select a registered unit for this part."}, 400)
            cursor = conn.execute(
                """
                INSERT INTO shop_part_orders (
                  part_number, description, vendor, quantity, purchase_type, asset_number, unit_price_cents,
                  order_date, pickup_date, status,
                  created_by, created_at, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (part_number, description, vendor, quantity, purchase_type, asset_number, unit_price_cents,
                 order_date, pickup_date, status,
                 user["username"], now, user["username"], now),
            )
            row = conn.execute("SELECT * FROM shop_part_orders WHERE id = ?", (cursor.lastrowid,)).fetchone()
            inventory_result = self.add_received_order_to_inventory(conn, row, user["username"]) if status == "Order Received" else {"inventoryUpdated": False}
        self.send_json({**self.shop_part_order_payload(row), **inventory_result}, 201)

    def receive_shop_part_order(self, record_id):
        user = self.require_admin()
        if user is None:
            return
        try:
            numeric_id = int(record_id)
        except ValueError:
            return self.send_json({"error": "Invalid parts order."}, 400)
        pickup_date = str(self.read_json().get("pickupDate") or local_today()).strip()
        try:
            datetime.strptime(pickup_date, "%Y-%m-%d")
        except ValueError:
            return self.send_json({"error": "Select a valid pickup date."}, 400)
        with connect() as conn:
            cursor = conn.execute(
                """
                UPDATE shop_part_orders
                SET status = 'Order Received', pickup_date = ?, updated_by = ?, updated_at = ?
                WHERE id = ? AND status = 'Waiting for Order'
                """,
                (pickup_date, user["username"], iso_now(), numeric_id),
            )
            if cursor.rowcount == 0:
                return self.send_json({"error": "Waiting parts order was not found."}, 404)
            row = conn.execute("SELECT * FROM shop_part_orders WHERE id = ?", (numeric_id,)).fetchone()
            inventory_result = self.add_received_order_to_inventory(conn, row, user["username"])
        self.send_json({**self.shop_part_order_payload(row), **inventory_result})

    def out_of_service_payload(self, row):
        return {
            "id": int(row["id"]),
            "assetNumber": row["asset_number"],
            "issue": row["issue"],
            "outDate": row["out_date"],
            "etaDate": row["eta_date"] or "",
            "noEta": bool(row["eta_not_available"]),
            "status": row["status"],
            "thirdPartyShop": row["third_party_shop"] or "",
            "thirdPartySendDate": row["third_party_send_date"] or "",
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedBy": row["updated_by"],
            "updatedAt": row["updated_at"],
            "fixedAt": row["fixed_at"] or "",
            "repairCost": f"{int(row['repair_cost_cents'] or 0) / 100:.2f}",
            "repairNotes": row["repair_notes"] or "",
            "completedDate": row["completed_date"] or "",
            "repairOrderId": int(row["repair_order_id"]) if row["repair_order_id"] is not None else None,
        }

    def list_shop_out_of_service(self):
        if self.require_shop_viewer() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM shop_out_of_service
                ORDER BY CASE WHEN status = 'Fixed' THEN 1 ELSE 0 END, out_date DESC, id DESC
                """
            ).fetchall()
        self.send_json([self.out_of_service_payload(row) for row in rows])

    def validate_out_of_service_fields(self, status, eta_date, no_eta, third_party_shop, third_party_send_date):
        if status not in OUT_OF_SERVICE_STATUSES:
            return "Select a valid repair status."
        if status != "Fixed" and not no_eta:
            try:
                datetime.strptime(eta_date, "%Y-%m-%d")
            except ValueError:
                return "Select an ETA to fix the unit."
        if status in THIRD_PARTY_OUT_OF_SERVICE_STATUSES:
            if not third_party_shop:
                return "Enter the third-party shop name."
            try:
                datetime.strptime(third_party_send_date, "%Y-%m-%d")
            except ValueError:
                return "Select the date the unit will be sent to the third-party shop."
        return ""

    def save_shop_out_of_service(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        asset_number = str(data.get("assetNumber") or "").strip()
        issue = str(data.get("issue") or "").strip()
        out_date = str(data.get("outDate") or local_today()).strip()
        eta_date = str(data.get("etaDate") or "").strip()
        no_eta = data.get("noEta") is True
        if no_eta:
            eta_date = ""
        status = str(data.get("status") or "Diagnosing").strip()
        third_party_shop = str(data.get("thirdPartyShop") or "").strip()
        third_party_send_date = str(data.get("thirdPartySendDate") or "").strip()
        if not asset_number or not issue:
            return self.send_json({"error": "Select a unit and describe the issue."}, 400)
        try:
            datetime.strptime(out_date, "%Y-%m-%d")
        except ValueError:
            return self.send_json({"error": "Select a valid out-of-service date."}, 400)
        error = self.validate_out_of_service_fields(status, eta_date, no_eta, third_party_shop, third_party_send_date)
        if error:
            return self.send_json({"error": error}, 400)
        if status not in THIRD_PARTY_OUT_OF_SERVICE_STATUSES:
            third_party_shop = ""
            third_party_send_date = ""
        now = iso_now()
        with connect() as conn:
            unit = conn.execute(
                "SELECT 1 FROM shop_unit_types WHERE asset_number = ? COLLATE NOCASE",
                (asset_number,),
            ).fetchone()
            if unit is None:
                return self.send_json({"error": "Select a registered unit."}, 400)
            existing = conn.execute(
                "SELECT 1 FROM shop_out_of_service WHERE asset_number = ? COLLATE NOCASE AND status <> 'Fixed'",
                (asset_number,),
            ).fetchone()
            if existing is not None:
                return self.send_json({"error": "This unit already has an active out-of-service report."}, 409)
            cursor = conn.execute(
                """
                INSERT INTO shop_out_of_service (
                  asset_number, issue, out_date, eta_date, eta_not_available, status, third_party_shop, third_party_send_date,
                  created_by, created_at, updated_by, updated_at, fixed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_number, issue, out_date, eta_date, 1 if no_eta else 0, status, third_party_shop, third_party_send_date,
                    user["username"], now, user["username"], now, now if status == "Fixed" else "",
                ),
            )
            row = conn.execute("SELECT * FROM shop_out_of_service WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self.send_json(self.out_of_service_payload(row), 201)

    def update_shop_out_of_service_status(self, record_id):
        user = self.require_admin()
        if user is None:
            return
        try:
            numeric_id = int(record_id)
        except ValueError:
            return self.send_json({"error": "Invalid out-of-service report."}, 400)
        data = self.read_json()
        status = str(data.get("status") or "").strip()
        eta_date = str(data.get("etaDate") or "").strip()
        no_eta = data.get("noEta") is True
        if no_eta:
            eta_date = ""
        third_party_shop = str(data.get("thirdPartyShop") or "").strip()
        third_party_send_date = str(data.get("thirdPartySendDate") or "").strip()
        repair_notes = str(data.get("repairNotes") or "").strip()
        raw_repair_cost = str(data.get("repairCost") or "0").strip()
        now = iso_now()
        with connect() as conn:
            existing = conn.execute(
                "SELECT * FROM shop_out_of_service WHERE id = ?",
                (numeric_id,),
            ).fetchone()
            if existing is None:
                return self.send_json({"error": "Out-of-service report was not found."}, 404)
            if status not in THIRD_PARTY_OUT_OF_SERVICE_STATUSES:
                third_party_shop = existing["third_party_shop"] or ""
                third_party_send_date = existing["third_party_send_date"] or ""
            error = self.validate_out_of_service_fields(status, eta_date, no_eta, third_party_shop, third_party_send_date)
            if error:
                return self.send_json({"error": error}, 400)
            repair_cost_cents = int(existing["repair_cost_cents"] or 0)
            completed_date = existing["completed_date"] or ""
            repair_order_id = existing["repair_order_id"]
            if status == "Fixed":
                if not repair_notes:
                    return self.send_json({"error": "Enter notes describing the completed repair."}, 400)
                try:
                    repair_cost = Decimal(raw_repair_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    repair_cost_cents = int(repair_cost * 100)
                except (InvalidOperation, TypeError, ValueError):
                    return self.send_json({"error": "Enter a valid repair cost."}, 400)
                if not repair_cost.is_finite() or repair_cost < 0:
                    return self.send_json({"error": "Repair cost cannot be negative."}, 400)
                completed_date = local_today()
                if repair_order_id is None:
                    description = f"Out-of-service issue: {existing['issue']}\nRepair completed: {repair_notes}"
                    order_cursor = conn.execute(
                        """
                        INSERT INTO shop_repair_orders (
                          order_date, location, technician_username, technician_name, driver_name,
                          asset_number, asset_mileage, asset_hours, job_description, status,
                          additional_cost_cents, source, source_reference_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Completed', ?, 'Out of Service', ?, ?)
                        """,
                        (
                            completed_date, third_party_shop or "Sunwave Shop", user["username"], user["name"],
                            "Not provided", existing["asset_number"], "0", "0", description,
                            repair_cost_cents, numeric_id, now,
                        ),
                    )
                    repair_order_id = order_cursor.lastrowid
            cursor = conn.execute(
                """
                UPDATE shop_out_of_service
                SET status = ?, eta_date = ?, eta_not_available = ?, third_party_shop = ?, third_party_send_date = ?,
                    updated_by = ?, updated_at = ?, fixed_at = ?, repair_cost_cents = ?,
                    repair_notes = ?, completed_date = ?, repair_order_id = ?
                WHERE id = ?
                """,
                (
                    status, eta_date, 1 if no_eta else 0, third_party_shop, third_party_send_date, user["username"], now,
                    now if status == "Fixed" else "", repair_cost_cents,
                    repair_notes if status == "Fixed" else existing["repair_notes"], completed_date,
                    repair_order_id, numeric_id,
                ),
            )
            row = conn.execute("SELECT * FROM shop_out_of_service WHERE id = ?", (numeric_id,)).fetchone()
        self.send_json(self.out_of_service_payload(row))

    def list_shop_service_schedules(self):
        user = self.require_shop_viewer()
        if user is None:
            return
        with connect() as conn:
            today = local_today()
            conn.execute(
                """
                UPDATE shop_service_schedules
                SET original_scheduled_date = CASE WHEN original_scheduled_date = '' THEN scheduled_date ELSE original_scheduled_date END,
                    scheduled_date = ?, updated_by = 'Automatic rollover', updated_at = ?
                WHERE status IN ('Scheduled', 'Working on it') AND scheduled_date < ?
                """,
                (today, iso_now(), today),
            )
            schedules = conn.execute(
                "SELECT * FROM shop_service_schedules WHERE status NOT IN ('Completed', 'Cancelled') ORDER BY scheduled_date, scheduled_time, id"
            ).fetchall()
            result = []
            for schedule in schedules:
                codes = conn.execute(
                    "SELECT code, description, labor_minutes FROM shop_service_schedule_codes WHERE schedule_id = ? ORDER BY code COLLATE NOCASE",
                    (schedule["id"],),
                ).fetchall()
                result.append({
                    "id": int(schedule["id"]),
                    "date": schedule["scheduled_date"],
                    "originalScheduledDate": schedule["original_scheduled_date"] or schedule["scheduled_date"],
                    "workingStartedDate": (schedule["working_started_at"] or "")[:10],
                    "completedDate": (schedule["completed_at"] or "")[:10],
                    "time": schedule["scheduled_time"],
                    "shift": schedule["shift"] or "Day",
                    "location": schedule["location"],
                    "assetNumber": schedule["asset_number"],
                    "driverName": schedule["driver_name"] or "",
                    "technicianName": schedule["technician_name"],
                    "technicianUsername": schedule["technician_username"],
                    "priority": schedule["priority"],
                    "notes": schedule["notes"],
                    "status": schedule["status"],
                    "repairCodes": [
                        {
                            "code": code["code"],
                            "description": code["description"],
                            **({"laborHours": f"{int(code['labor_minutes']) / 60:.2f}"} if user["role"] == "Admin" else {}),
                        }
                        for code in codes
                    ],
                    "createdBy": schedule["created_by"],
                    "createdAt": schedule["created_at"],
                    "updatedBy": schedule["updated_by"],
                    "updatedAt": schedule["updated_at"],
                    "repairOrderId": int(schedule["repair_order_id"]) if schedule["repair_order_id"] is not None else None,
                })
        self.send_json(result)

    def list_shop_service_day_statuses(self):
        if self.require_shop_viewer() is None:
            return
        with connect() as conn:
            rows = conn.execute(
                "SELECT service_date, status, updated_by, updated_at FROM shop_service_day_statuses ORDER BY service_date"
            ).fetchall()
        self.send_json([
            {
                "date": row["service_date"],
                "status": row["status"],
                "updatedBy": row["updated_by"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ])

    def save_shop_service_day_status(self):
        user = self.require_admin()
        if user is None:
            return
        data = self.read_json()
        service_date = str(data.get("date") or "").strip()
        status = str(data.get("status") or "").strip()
        try:
            datetime.strptime(service_date, "%Y-%m-%d")
        except ValueError:
            return self.send_json({"error": "Select a valid service date."}, 400)
        if status not in ("Available", "Unavailable"):
            return self.send_json({"error": "Select Available or Unavailable."}, 400)
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO shop_service_day_statuses (service_date, status, updated_by, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(service_date) DO UPDATE SET
                  status = excluded.status,
                  updated_by = excluded.updated_by,
                  updated_at = excluded.updated_at
                """,
                (service_date, status, user["username"], iso_now()),
            )
        self.send_json({"ok": True, "date": service_date, "status": status})

    def save_shop_service_schedule(self):
        user = self.require_shop_scheduler()
        if user is None:
            return
        data = self.read_json()
        scheduled_date = str(data.get("date") or "").strip()
        scheduled_time = str(data.get("time") or "").strip()
        shift = str(data.get("shift") or "Day").strip()
        location = str(data.get("location") or "").strip()
        asset_number = str(data.get("assetNumber") or "").strip()
        driver_name = str(data.get("driverName") or "").strip()
        technician_name = "Unassigned"
        technician_username = ""
        priority = str(data.get("priority") or "Normal").strip()
        notes = str(data.get("notes") or "").strip()
        try:
            datetime.strptime(scheduled_date, "%Y-%m-%d")
            datetime.strptime(scheduled_time, "%H:%M")
        except ValueError:
            return self.send_json({"error": "Enter a valid scheduled date and time."}, 400)
        if not location or not asset_number or not driver_name or not notes:
            return self.send_json({"error": "Location, asset number, driver name, and service notes are required."}, 400)
        if priority not in ("Low", "Normal", "High", "Urgent"):
            return self.send_json({"error": "Select a valid priority."}, 400)
        if shift not in ("Day", "Night"):
            return self.send_json({"error": "Select Day Shift or Night Shift."}, 400)
        with connect() as conn:
            asset = conn.execute(
                "SELECT 1 FROM shop_unit_types WHERE asset_number = ? COLLATE NOCASE",
                (asset_number,),
            ).fetchone()
            if asset is None:
                return self.send_json({"error": "Select a registered asset number."}, 400)
            day_status = conn.execute(
                "SELECT status FROM shop_service_day_statuses WHERE service_date = ?",
                (scheduled_date,),
            ).fetchone()
            if day_status and day_status["status"] == "Unavailable":
                return self.send_json({"error": "That day is unavailable for additional services. Select another day."}, 409)
            now = iso_now()
            cursor = conn.execute(
                """
                INSERT INTO shop_service_schedules (
                  scheduled_date, original_scheduled_date, scheduled_time, shift, location, asset_number, driver_name, technician_name, technician_username,
                  priority, notes, status, created_by, created_at, updated_by, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?, ?)
                """,
                (scheduled_date, scheduled_date, scheduled_time, shift, location, asset_number, driver_name, technician_name, technician_username,
                 priority, notes, user["username"], now, user["username"], now),
            )
            schedule_id = cursor.lastrowid
        self.send_json({"ok": True, "id": schedule_id, "status": "Scheduled"})

    def update_shop_service_schedule_status(self, schedule_id):
        user = self.require_shop_technician()
        if user is None:
            return
        try:
            schedule_id = int(schedule_id)
        except (TypeError, ValueError):
            return self.send_json({"error": "Scheduled repair was not found."}, 400)
        status = str(self.read_json().get("status") or "").strip()
        if status not in ("Scheduled", "Working on it", "Completed", "Cancelled"):
            return self.send_json({"error": "Select a valid status."}, 400)
        if user["role"] == "Technician" and status not in ("Working on it", "Completed"):
            return self.send_json({"error": "Technicians can only start or complete a repair."}, 403)
        with connect() as conn:
            schedule = conn.execute(
                "SELECT * FROM shop_service_schedules WHERE id = ?",
                (schedule_id,),
            ).fetchone()
            if schedule is None:
                return self.send_json({"error": "Scheduled repair was not found."}, 404)
            technician_username = schedule["technician_username"] or ""
            technician_name = schedule["technician_name"] or "Unassigned"
            if status in ("Working on it", "Completed"):
                if user["role"] == "Technician" and technician_username and technician_username != user["username"]:
                    return self.send_json({"error": f"This repair is already assigned to {technician_name}."}, 409)
                if not technician_username:
                    technician_username = user["username"]
                    technician_name = user["name"]
            repair_order_id = schedule["repair_order_id"]
            now = iso_now()
            if status in ("Completed", "Cancelled") and repair_order_id is None:
                cursor = conn.execute(
                    """
                    INSERT INTO shop_repair_orders (
                      order_date, location, technician_username, technician_name,
                      driver_name, asset_number, asset_mileage, asset_hours, job_description, status,
                      source, source_reference_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, '0', '0', ?, ?, 'Scheduled Service', ?, ?)
                    """,
                    (
                        schedule["scheduled_date"], schedule["location"], technician_username,
                        technician_name, schedule["driver_name"] or "", schedule["asset_number"],
                        schedule["notes"] or f"Scheduled service {status.lower()}.", status, schedule_id, now,
                    ),
                )
                repair_order_id = cursor.lastrowid
                scheduled_codes = conn.execute(
                    "SELECT code, description, labor_minutes FROM shop_service_schedule_codes WHERE schedule_id = ?",
                    (schedule_id,),
                ).fetchall()
                conn.executemany(
                    "INSERT INTO shop_repair_order_codes (repair_order_id, code, description, labor_minutes) VALUES (?, ?, ?, ?)",
                    [(repair_order_id, code["code"], code["description"], code["labor_minutes"]) for code in scheduled_codes],
                )
            cursor = conn.execute(
                """
                UPDATE shop_service_schedules
                SET status = ?, technician_username = ?, technician_name = ?,
                    working_started_at = CASE
                      WHEN ? IN ('Working on it', 'Completed') AND working_started_at = '' THEN ?
                      ELSE working_started_at END,
                    completed_at = CASE WHEN ? = 'Completed' THEN ? ELSE completed_at END,
                    updated_by = ?, updated_at = ?
                WHERE id = ?
                """,
                (status, technician_username, technician_name, status, now, status, now,
                 user["username"], now, schedule_id),
            )
            if repair_order_id is not None:
                conn.execute(
                    "UPDATE shop_service_schedules SET repair_order_id = ? WHERE id = ?",
                    (repair_order_id, schedule_id),
                )
                if status in ("Completed", "Cancelled"):
                    conn.execute(
                        "UPDATE shop_repair_orders SET status = ? WHERE id = ?",
                        (status, repair_order_id),
                    )
        self.send_json({"ok": True, "id": schedule_id, "status": status, "repairOrderId": repair_order_id})

    def delete_shop_service_schedule(self, schedule_id):
        if self.require_admin() is None:
            return
        try:
            schedule_id = int(schedule_id)
        except (TypeError, ValueError):
            return self.send_json({"error": "Scheduled repair was not found."}, 400)
        with connect() as conn:
            schedule = conn.execute(
                "SELECT repair_order_id FROM shop_service_schedules WHERE id = ?",
                (schedule_id,),
            ).fetchone()
            if schedule is None:
                return self.send_json({"error": "Scheduled repair was not found."}, 404)
            conn.execute("DELETE FROM shop_service_schedule_codes WHERE schedule_id = ?", (schedule_id,))
            conn.execute("DELETE FROM shop_service_schedules WHERE id = ?", (schedule_id,))
        self.send_json({
            "ok": True,
            "id": schedule_id,
            "savedRepairOrderPreserved": schedule["repair_order_id"] is not None,
        })

    def save_quantity_asset(self):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to save quantity assets."}, 403)

        data = self.read_json()
        categories = data.get("categories")
        if not isinstance(categories, list):
            categories = [data.get("category")]
        categories = sorted({str(category or "").strip() for category in categories if str(category or "").strip()})
        master_number = (data.get("masterNumber") or "").strip()
        if not categories or not master_number:
            return self.send_json({"error": "Select at least one category and add a master number."}, 400)

        now = iso_now()
        with connect() as conn:
            existing = conn.execute(
                "SELECT MAX(quantity) AS quantity FROM quantity_assets WHERE master_number = ?",
                (master_number,),
            ).fetchone()
            current_quantity = int(existing["quantity"] or 0) if existing else 0
            for category in categories:
                conn.execute(
                    "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
                    (category, now),
                )
                conn.execute(
                    """
                    INSERT INTO quantity_assets (category, master_number, quantity, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(category) DO UPDATE SET
                      master_number = excluded.master_number,
                      quantity = excluded.quantity,
                      updated_at = excluded.updated_at
                    """,
                    (category, master_number, current_quantity, now),
                )
        self.send_json({"ok": True})

    def adjust_quantity_asset(self):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to change quantity assets."}, 403)

        data = self.read_json()
        master_number = (data.get("masterNumber") or "").strip()
        category = (data.get("category") or "").strip()
        action = (data.get("action") or "").strip()
        job_name = (data.get("jobName") or "").strip()
        try:
            quantity = int(data.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0

        if not master_number and not category:
            return self.send_json({"error": "Select a master number."}, 400)
        if action not in ("Add", "Use"):
            return self.send_json({"error": "Select Add or Use."}, 400)
        if quantity <= 0:
            return self.send_json({"error": "Quantity must be greater than zero."}, 400)
        if action == "Use" and not job_name:
            return self.send_json({"error": "Select the job where this quantity was used."}, 400)
        if action == "Use" and not is_real_job_assignment(job_name):
            return self.send_json({"error": "Reduce quantity must be assigned to a job."}, 400)

        with connect() as conn:
            try:
                if action == "Add":
                    next_quantity = self.add_quantity_asset(conn, master_number or category, quantity, user["username"])
                    if is_yard_assignment(job_name):
                        next_quantity = self.use_quantity_asset(conn, master_number or category, quantity, YARD_JOB_NAME, user["username"])
                else:
                    next_quantity = self.use_quantity_asset(conn, master_number or category, quantity, job_name, user["username"])
            except ValueError as error:
                return self.send_json({"error": str(error)}, 400)

        self.send_json({"ok": True, "quantity": next_quantity})

    def quantity_asset_rows(self, conn, master_number):
        rows = conn.execute(
            "SELECT * FROM quantity_assets WHERE master_number = ? ORDER BY category ASC",
            (master_number,),
        ).fetchall()
        if rows:
            return master_number, rows
        row = conn.execute(
            "SELECT master_number FROM quantity_assets WHERE category = ?",
            (master_number,),
        ).fetchone()
        if row:
            master_number = row["master_number"]
            rows = conn.execute(
                "SELECT * FROM quantity_assets WHERE master_number = ? ORDER BY category ASC",
                (master_number,),
            ).fetchall()
        return master_number, rows

    def add_quantity_asset(self, conn, master_number, quantity, username):
        master_number, rows = self.quantity_asset_rows(conn, master_number)
        if not rows:
            raise ValueError("This master number is not enabled for quantity tracking yet.")
        now = iso_now()
        current_quantity = int(max(row["quantity"] or 0 for row in rows))
        next_quantity = current_quantity + quantity
        conn.execute(
            "UPDATE quantity_assets SET quantity = ?, updated_at = ? WHERE master_number = ?",
            (next_quantity, now, master_number),
        )
        category_summary = ", ".join(row["category"] for row in rows)
        conn.execute(
            """
            INSERT INTO quantity_asset_history (
              category, master_number, job_name, change_type, quantity,
              balance_after, changed_by, changed_at
            )
            VALUES (?, ?, ?, 'Add', ?, ?, ?, ?)
            """,
            (category_summary, master_number, "", quantity, next_quantity, username, now),
        )
        return next_quantity

    def add_quantity_asset_assignment(self, conn, master_number, quantity, job_name, username, latitude="", longitude=""):
        master_number, rows = self.quantity_asset_rows(conn, master_number)
        if not rows:
            raise ValueError("This master number is not enabled for quantity tracking yet.")
        now = iso_now()
        current_quantity = int(max(row["quantity"] or 0 for row in rows))
        category_summary = ", ".join(row["category"] for row in rows)
        conn.execute("UPDATE quantity_assets SET updated_at = ? WHERE master_number = ?", (now, master_number))
        conn.execute(
            """
            INSERT INTO quantity_asset_history (
              category, master_number, job_name, change_type, quantity,
              balance_after, latitude, longitude, changed_by, changed_at
            )
            VALUES (?, ?, ?, 'Add', ?, ?, ?, ?, ?, ?)
            """,
            (category_summary, master_number, job_name, quantity, current_quantity, latitude, longitude, username, now),
        )
        return current_quantity

    def use_quantity_asset(self, conn, master_number, quantity, job_name, username, latitude="", longitude=""):
        master_number, rows = self.quantity_asset_rows(conn, master_number)
        if not rows:
            raise ValueError("This master number is not enabled for quantity tracking yet.")
        current_quantity = int(max(row["quantity"] or 0 for row in rows))
        assigned_available = self.quantity_asset_assignment_quantity(conn, master_number, "available")
        assigned_yard = self.quantity_asset_assignment_quantity(conn, master_number, "yard")
        usable_quantity = current_quantity + assigned_available + assigned_yard if is_real_job_assignment(job_name) else current_quantity
        if quantity > usable_quantity:
            raise ValueError("Not enough quantity available for this use.")
        now = iso_now()
        next_quantity = max(current_quantity - quantity, 0)
        conn.execute(
            "UPDATE quantity_assets SET quantity = ?, updated_at = ? WHERE master_number = ?",
            (next_quantity, now, master_number),
        )
        category_summary = ", ".join(row["category"] for row in rows)
        if is_real_job_assignment(job_name) and quantity > current_quantity:
            remaining_transfer = quantity - current_quantity
            yard_transfer = min(assigned_yard, remaining_transfer)
            if yard_transfer > 0:
                self.record_quantity_assignment_transfer(
                    conn, category_summary, master_number, YARD_JOB_NAME, yard_transfer, next_quantity, username, now
                )
                remaining_transfer -= yard_transfer
            available_transfer = min(assigned_available, remaining_transfer)
            if available_transfer > 0:
                self.record_quantity_assignment_transfer(
                    conn, category_summary, master_number, "Available", available_transfer, next_quantity, username, now
                )
        conn.execute(
            """
            INSERT INTO quantity_asset_history (
              category, master_number, job_name, change_type, quantity,
              balance_after, latitude, longitude, changed_by, changed_at
            )
            VALUES (?, ?, ?, 'Use', ?, ?, ?, ?, ?, ?)
            """,
            (category_summary, master_number, job_name, quantity, next_quantity, latitude, longitude, username, now),
        )
        return next_quantity

    def quantity_asset_assignment_quantity(self, conn, master_number, assignment):
        if assignment == "yard":
            rows = conn.execute(
                """
                SELECT quantity FROM quantity_asset_history
                WHERE master_number = ? AND change_type IN ('Use', 'Add')
                  AND LOWER(TRIM(COALESCE(job_name, ''))) IN ('yard', 'big spring yard')
                """,
                (master_number,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT quantity FROM quantity_asset_history
                WHERE master_number = ? AND change_type = 'Use'
                  AND (TRIM(COALESCE(job_name, '')) = '' OR LOWER(TRIM(COALESCE(job_name, ''))) = 'available')
                """,
                (master_number,),
            ).fetchall()
        return sum(int(row["quantity"] or 0) for row in rows)

    def record_quantity_assignment_transfer(self, conn, category, master_number, job_name, quantity, balance_after, username, changed_at):
        conn.execute(
            """
            INSERT INTO quantity_asset_history (
              category, master_number, job_name, change_type, quantity,
              balance_after, changed_by, changed_at
            )
            VALUES (?, ?, ?, 'Use', ?, ?, ?, ?)
            """,
            (category, master_number, job_name, -quantity, balance_after, username, changed_at),
        )

    def delete_quantity_asset(self, master_number):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to delete quantity assets."}, 403)

        master_number = (master_number or "").strip()
        if not master_number:
            return self.send_json({"error": "Master number is required."}, 400)

        with connect() as conn:
            rows = conn.execute(
                "SELECT category FROM quantity_assets WHERE master_number = ?",
                (master_number,),
            ).fetchall()
            if not rows:
                return self.send_json({"error": "This master number was not found."}, 404)
            conn.execute("DELETE FROM quantity_assets WHERE master_number = ?", (master_number,))
        self.send_json({"ok": True})

    def save_job(self):
        if self.require_admin() is None:
            return
        data = self.read_json()
        name = (data.get("name") or "").strip()
        if not name:
            return self.send_json({"error": "Job name is required."}, 400)
        with connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO jobs (name, created_at) VALUES (?, ?)",
                (name, iso_now()),
            )
        self.send_json({"ok": True})

    def save_job_audit(self):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to save job audits."}, 403)

        data = self.read_json()
        audit_date = (data.get("auditDate") or "").strip()
        job_name = (data.get("jobName") or "").strip()
        item_type = (data.get("itemType") or "").strip()
        asset_number = (data.get("assetNumber") or "").strip()
        master_number = (data.get("masterNumber") or "").strip()
        try:
            master_quantity = int(data.get("masterQuantity") or 0)
        except (TypeError, ValueError):
            master_quantity = 0
        hose_size = (data.get("hoseSize") or "").strip()
        total_hose = (data.get("totalHose") or "").strip()
        latitude = (data.get("latitude") or "").strip()
        longitude = (data.get("longitude") or "").strip()
        notes = (data.get("notes") or "").strip()

        if master_number or master_quantity:
            item_type = "Master Quantity"
        if item_type not in ("Asset", "Crossing", "Pump", "Pig Around", "Master Quantity"):
            return self.send_json({"error": "Select a valid audit type."}, 400)
        if not audit_date or not job_name:
            return self.send_json({"error": "Date and job are required."}, 400)
        if item_type == "Asset" and not asset_number:
            return self.send_json({"error": "Asset number is required for asset audit entries."}, 400)
        if item_type == "Master Quantity":
            if not master_number or master_quantity <= 0:
                return self.send_json({"error": "Select a master number and enter the quantity used."}, 400)
            asset_number = f"Master #{master_number} x {master_quantity}"
        hose_values = [value.strip() for value in hose_size.split(",") if value.strip()]
        if any(value not in ("16", "12", "10") for value in hose_values):
            return self.send_json({"error": "Select a valid hose size."}, 400)
        if hose_values and not total_hose:
            return self.send_json({"error": "Total hose is required when hose size is selected."}, 400)
        total_hose_by_size = {}
        for part in [value.strip() for value in total_hose.split(",") if value.strip()]:
            if ":" in part:
                size, amount = part.split(":", 1)
                total_hose_by_size[size.strip()] = amount.strip()
        if len(hose_values) > 1 and any(not total_hose_by_size.get(value) for value in hose_values):
            return self.send_json({"error": "Add a total hose value for every selected hose size."}, 400)
        if not latitude or not longitude:
            return self.send_json({"error": "Geolocation is required."}, 400)

        now = iso_now()
        with connect() as conn:
            if item_type == "Asset":
                registered_asset = conn.execute(
                    """
                    SELECT id
                    FROM equipment
                    WHERE id = ? OR name = ? OR asset_tag = ?
                    """,
                    (asset_number, asset_number, asset_number),
                ).fetchone()
                if not registered_asset:
                    return self.send_json({"error": "This asset is not registered yet. Register it before adding it to a job audit."}, 400)
            if item_type == "Master Quantity":
                try:
                    self.use_quantity_asset(conn, master_number, master_quantity, job_name, user["username"], latitude, longitude)
                except ValueError as error:
                    return self.send_json({"error": str(error)}, 400)

            conn.execute(
                """
                INSERT INTO job_audits (
                  audit_date, job_name, item_type, asset_number,
                  hose_size, total_hose, latitude, longitude, notes, created_by, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    audit_date,
                    job_name,
                    item_type,
                    asset_number,
                    hose_size,
                    total_hose,
                    latitude,
                    longitude,
                    notes,
                    user["username"],
                    now,
                ),
            )
        self.send_json({"ok": True})

    def save_job_audit_list(self):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to save job audit lists."}, 403)

        batch_id = str(uuid.uuid4())
        status = "Running"
        saved_at = iso_now()
        with connect() as conn:
            count = conn.execute("SELECT COUNT(*) AS count FROM job_audits").fetchone()["count"]
            if not count:
                return self.send_json({"error": "There are no audit entries to save."}, 400)
            conn.execute(
                """
                INSERT INTO saved_job_audits (
                  batch_id, status, audit_date, job_name, item_type, asset_number,
                  hose_size, total_hose, latitude, longitude, notes, created_by, created_at,
                  saved_by, saved_at
                )
                SELECT
                  ?, ?, audit_date, job_name, item_type, asset_number,
                  hose_size, total_hose, latitude, longitude, notes, created_by, created_at,
                  ?, ?
                FROM job_audits
                ORDER BY id ASC
                """,
                (batch_id, status, user["username"], saved_at),
            )
            conn.execute("DELETE FROM job_audits")
        self.send_json({"ok": True, "count": count, "batchId": batch_id, "status": status, "savedBy": user["username"]})

    def update_current_audit_status(self, batch_id):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to update current audits."}, 403)

        data = self.read_json()
        status = (data.get("status") or "").strip()
        if status not in ("Running", "Rigging Down", "Job Done"):
            return self.send_json({"error": "Select a valid status."}, 400)
        if not batch_id:
            return self.send_json({"error": "Audit id is required."}, 400)

        with connect() as conn:
            cursor = conn.execute(
                "UPDATE saved_job_audits SET status = ? WHERE batch_id = ?",
                (status, batch_id),
            )
            if cursor.rowcount == 0:
                return self.send_json({"error": "Saved audit was not found."}, 404)
            released_count = self.release_current_audit_assets(conn, batch_id, status, user["username"])
        self.send_json({"ok": True, "batchId": batch_id, "status": status, "releasedCount": released_count})

    def release_current_audit_assets(self, conn, batch_id, audit_status, username):
        if audit_status not in ("Rigging Down", "Job Done"):
            return 0

        now = iso_now()
        released_count = 0
        rows = conn.execute(
            """
            SELECT DISTINCT job_name, asset_number
            FROM saved_job_audits
            WHERE batch_id = ?
              AND item_type = 'Asset'
              AND COALESCE(asset_number, '') <> ''
            """,
            (batch_id,),
        ).fetchall()

        for row in rows:
            asset_number = row["asset_number"]
            equipment = conn.execute(
                """
                SELECT id, name, asset_tag
                FROM equipment
                WHERE id = ? OR name = ? OR asset_tag = ?
                LIMIT 1
                """,
                (asset_number, asset_number, asset_number),
            ).fetchone()

            equipment_id = equipment["id"] if equipment else ""
            equipment_name = equipment["name"] if equipment else asset_number
            asset_tag = equipment["asset_tag"] if equipment else ""

            duplicate = conn.execute(
                """
                SELECT id FROM job_audit_asset_history
                WHERE batch_id = ?
                  AND asset_number = ?
                  AND audit_status = ?
                LIMIT 1
                """,
                (batch_id, asset_number, audit_status),
            ).fetchone()
            if duplicate:
                continue

            if equipment:
                conn.execute(
                    """
                    UPDATE equipment
                    SET status = 'Available',
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (now, equipment_id),
                )
                conn.execute(
                    """
                    INSERT INTO asset_history (
                      equipment_id, equipment_name, asset_tag, assigned_to,
                      latitude, longitude, changed_by, changed_at
                    )
                    SELECT id, name, asset_tag, assigned_to, latitude, longitude, ?, ?
                    FROM equipment
                    WHERE id = ?
                    """,
                    (username, now, equipment_id),
                )
                released_count += 1

            conn.execute(
                """
                INSERT INTO job_audit_asset_history (
                  batch_id, job_name, asset_number, equipment_id, equipment_name,
                  asset_tag, audit_status, released_status, changed_by, changed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Available', ?, ?)
                """,
                (
                    batch_id,
                    row["job_name"],
                    asset_number,
                    equipment_id,
                    equipment_name,
                    asset_tag,
                    audit_status,
                    username,
                    now,
                ),
            )

        return released_count

    def delete_job(self, name):
        if self.require_admin() is None:
            return
        with connect() as conn:
            in_use = conn.execute("SELECT COUNT(*) AS count FROM equipment WHERE assigned_to = ?", (name,)).fetchone()["count"]
            if in_use:
                return self.send_json({"error": "This job value is used by equipment and cannot be deleted."}, 409)
            conn.execute("DELETE FROM jobs WHERE name = ?", (name,))
        self.send_json({"ok": True})

    def save_category(self):
        if self.require_admin() is None:
            return
        data = self.read_json()
        name = (data.get("name") or "").strip()
        if not name:
            return self.send_json({"error": "Category name is required."}, 400)
        with connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO categories (name, created_at) VALUES (?, ?)",
                (name, iso_now()),
            )
        self.send_json({"ok": True})

    def delete_category(self, name):
        if self.require_admin() is None:
            return
        with connect() as conn:
            in_use = conn.execute("SELECT COUNT(*) AS count FROM equipment WHERE category = ?", (name,)).fetchone()["count"]
            if in_use:
                return self.send_json({"error": "This category is used by equipment and cannot be deleted."}, 409)
            conn.execute("DELETE FROM categories WHERE name = ?", (name,))
        self.send_json({"ok": True})

    def save_user(self):
        if self.require_admin() is None:
            return

        data = self.read_json()
        username = (data.get("username") or "").strip()
        original_username = (data.get("originalUsername") or "").strip()
        name = (data.get("name") or "").strip()
        role = (data.get("role") or "").strip()
        password = data.get("password") or ""

        if not username or not name or role not in ("Admin", "Manager", "Viewer", "Tracker Viewer", "Shop Viewer", "Scheduler", "Technician"):
            return self.send_json({"error": "Username, name, and role are required."}, 400)

        with connect() as conn:
            existing = conn.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
            if original_username:
                if username != original_username:
                    return self.send_json({"error": "Usernames cannot be changed."}, 400)
                if password:
                    conn.execute(
                        "UPDATE users SET name = ?, role = ?, password_hash = ? WHERE username = ?",
                        (name, role, password_hash(password), username),
                    )
                else:
                    conn.execute(
                        "UPDATE users SET name = ?, role = ? WHERE username = ?",
                        (name, role, username),
                    )
            else:
                if existing is not None:
                    return self.send_json({"error": "That username already exists."}, 409)
                if not password:
                    return self.send_json({"error": "Password is required for a new user."}, 400)
                conn.execute(
                    "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
                    (username, password_hash(password), name, role),
                )

        self.send_json({"ok": True})

    def save_equipment(self):
        user = self.require_user()
        if user is None:
            return
        if user["role"] not in ("Admin", "Manager"):
            return self.send_json({"error": "You do not have permission to save equipment."}, 403)

        data = self.read_json()
        master_number = data.get("masterNumber", "").strip()
        try:
            master_quantity = int(data.get("masterQuantity") or 0)
        except (TypeError, ValueError):
            master_quantity = 0
        has_equipment_fields = any((data.get(field) or "").strip() for field in ("name", "assetTag", "category"))

        if master_number or master_quantity:
            assigned_to = data.get("assignedTo", "").strip()
            if not master_number or master_quantity <= 0:
                return self.send_json({"error": "Select a master number and enter the quantity to add."}, 400)
            if is_available_assignment(assigned_to):
                return self.send_json({"error": "Select an Assigned to Job before adding a master quantity."}, 400)
            if not has_equipment_fields:
                latitude = data.get("latitude", "").strip()
                longitude = data.get("longitude", "").strip()
                with connect() as conn:
                    try:
                        self.add_quantity_asset_assignment(conn, master_number, master_quantity, assigned_to, user["username"], latitude, longitude)
                    except ValueError as error:
                        return self.send_json({"error": str(error)}, 400)
                return self.send_json({"ok": True})

        if not all((data.get(field) or "").strip() for field in ("id", "name")):
            return self.send_json({"error": "Equipment number is required."}, 400)

        with connect() as conn:
            existing = conn.execute("SELECT * FROM equipment WHERE id = ?", (data.get("id"),)).fetchone()
            now = iso_now()
            equipment_id = data.get("id")
            equipment_name = data.get("name", "").strip()
            asset_tag = data.get("assetTag", "").strip()
            if asset_tag:
                duplicate_tag = conn.execute(
                    "SELECT id, name FROM equipment WHERE asset_tag = ? AND id <> ?",
                    (asset_tag, equipment_id),
                ).fetchone()
                if duplicate_tag:
                    return self.send_json({"error": f"That QR code is already assigned to {duplicate_tag['name'] or duplicate_tag['id']}."}, 400)
            assigned_to = data.get("assignedTo", "").strip()
            status = "Available" if is_available_assignment(assigned_to) else "Active"
            latitude = data.get("latitude", "").strip()
            longitude = data.get("longitude", "").strip()
            photos = data.get("photos") if isinstance(data.get("photos"), list) else []
            cleaned_photos = []
            for photo in photos[:6]:
                if not isinstance(photo, dict):
                    continue
                data_url = str(photo.get("dataUrl") or "")
                if not data_url.startswith("data:image/"):
                    continue
                cleaned_photos.append({
                    "name": str(photo.get("name") or "")[:160],
                    "type": str(photo.get("type") or "")[:80],
                    "dataUrl": data_url,
                })
            photos_json = json.dumps(cleaned_photos) if existing is None or data.get("photosProvided") else existing["photos"]
            if master_number and master_quantity:
                try:
                    self.add_quantity_asset_assignment(conn, master_number, master_quantity, assigned_to, user["username"], latitude, longitude)
                except ValueError as error:
                    return self.send_json({"error": str(error)}, 400)
            conn.execute(
                """
                INSERT INTO equipment (
                  id, name, asset_tag, category, status, assigned_to,
                  site, latitude, longitude, photos, notes, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  asset_tag = excluded.asset_tag,
                  category = excluded.category,
                  status = excluded.status,
                  assigned_to = excluded.assigned_to,
                  site = excluded.site,
                  latitude = excluded.latitude,
                  longitude = excluded.longitude,
                  photos = excluded.photos,
                  notes = excluded.notes,
                  updated_at = excluded.updated_at
                """,
                (
                    equipment_id,
                    equipment_name,
                    asset_tag,
                    data.get("category", "").strip() or "Uncategorized",
                    status,
                    assigned_to,
                    "",
                    latitude,
                    longitude,
                    photos_json,
                    data.get("notes", "").strip(),
                    now,
                ),
            )
            if self.should_record_history(existing, assigned_to, latitude, longitude):
                conn.execute(
                    """
                    INSERT INTO asset_history (
                      equipment_id, equipment_name, asset_tag, assigned_to,
                      latitude, longitude, changed_by, changed_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        equipment_id,
                        equipment_name,
                        asset_tag,
                        assigned_to,
                        latitude,
                        longitude,
                        user["username"],
                        now,
                    ),
                )
        self.send_json({"ok": True})

    def should_record_history(self, existing, assigned_to, latitude, longitude):
        if existing is None:
            return bool(assigned_to or latitude or longitude)
        return any(
            [
                (existing["assigned_to"] or "") != assigned_to,
                (existing["latitude"] or "") != latitude,
                (existing["longitude"] or "") != longitude,
            ]
        )

    def delete_equipment(self, equipment_id):
        user = self.require_user()
        if user is None:
            return
        if user["role"] != "Admin":
            return self.send_json({"error": "Only admins can delete equipment."}, 403)
        with connect() as conn:
            conn.execute("DELETE FROM equipment WHERE id = ?", (equipment_id,))
        self.send_json({"ok": True})

    def export_equipment(self):
        if self.require_user() is None:
            return
        with connect() as conn:
            rows = conn.execute("SELECT * FROM equipment ORDER BY updated_at DESC, name ASC").fetchall()

        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["Equipment Number", "Asset Tag", "Category", "Status", "Assigned to Job", "Latitude", "Longitude", "Notes", "Updated At"])
        for row in rows:
            item = equipment_from_row(row)
            writer.writerow([item["name"], item["assetTag"], item["category"], item["status"], item["assignedTo"], item["latitude"], item["longitude"], item["notes"], item["updatedAt"]])
        body = stream.getvalue().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", "attachment; filename=equipment-register.csv")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Run the Sunwave Tracker SQLite server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "4176")))
    args = parser.parse_args()

    init_db()
    start_inventory_auto_snapshot_scheduler()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Sunwave Tracker database app running at http://{args.host}:{args.port}/")
    print(f"SQLite database file: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
