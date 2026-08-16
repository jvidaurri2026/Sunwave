import datetime
import sqlite3

import server


def main():
    conn = sqlite3.connect("data/equiptrack.db")
    conn.row_factory = sqlite3.Row
    equipment = conn.execute(
        """
        SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category, COUNT(*) AS count
        FROM equipment
        WHERE LOWER(TRIM(COALESCE(assigned_to, ''))) = 'yard'
        GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
        ORDER BY category
        """
    ).fetchall()
    quantities = conn.execute(
        """
        SELECT master_number, category, SUM(quantity) AS quantity
        FROM quantity_asset_history
        WHERE change_type = 'Use'
          AND LOWER(TRIM(COALESCE(job_name, ''))) = 'yard'
        GROUP BY master_number, category
        HAVING quantity > 0
        ORDER BY master_number, category
        """
    ).fetchall()
    conn.close()

    total_assets = sum(row["count"] for row in equipment)
    total_quantity = sum(row["quantity"] for row in quantities)
    lines = [
        "Sunwave Tracker Yard Snapshot TEST",
        datetime.datetime.now().strftime("%b %d, %Y %I:%M %p"),
        f"Assets on Yard: {total_assets}",
        f"Master quantity on Yard: {total_quantity}",
        "",
        "Equipment:",
    ]
    lines.extend([f"{row['category']}: {row['count']}" for row in equipment] or ["None"])
    lines.extend(["", "Master quantities:"])
    lines.extend(
        [
            f"Master #{row['master_number']} - {row['category']}: {row['quantity']}"
            for row in quantities
        ]
        or ["None"]
    )
    server.post_groupme_message("\n".join(lines))
    print("sent")


if __name__ == "__main__":
    main()
