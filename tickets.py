"""Development tickets — bug / feature / idea / design requests.

Created from the admin UI (with images + free text), stored in SQLite, and
pulled by the developer via Claude Code:

    ./venv/bin/python tickets.py list
    ./venv/bin/python tickets.py show 7

Images are saved as files under data/tickets/<id>/ so they can be opened.
"""
import json
import sys
from pathlib import Path

import db

TICKETS_DIR = db.DB_PATH.parent / "tickets"

TYPE_HE = {
    "bug": "באג 🐞",
    "feature": "פיצ'ר ✨",
    "idea": "רעיון 💡",
    "design": "עיצוב 🎨",
}


def create_ticket(ttype, title, body, images=None):
    """images: list of (filename, bytes). Returns the new ticket id."""
    db.init_db()
    conn = db.get_conn()
    cur = conn.execute(
        "INSERT INTO tickets (type, title, body, images, status) VALUES (?,?,?,?,'open')",
        (ttype, title, body, "[]"),
    )
    tid = cur.lastrowid
    conn.commit()

    saved = []
    if images:
        dest = TICKETS_DIR / str(tid)
        dest.mkdir(parents=True, exist_ok=True)
        for i, (fname, data) in enumerate(images, 1):
            ext = Path(fname).suffix or ".png"
            out = dest / f"{i}{ext}"
            out.write_bytes(data)
            saved.append(f"tickets/{tid}/{out.name}")
        conn.execute("UPDATE tickets SET images=? WHERE id=?", (json.dumps(saved), tid))
        conn.commit()
    conn.close()
    return tid


def list_tickets(status=None):
    conn = db.get_conn()
    sql = "SELECT * FROM tickets"
    params = ()
    if status:
        sql += " WHERE status=?"
        params = (status,)
    sql += " ORDER BY id DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    conn.close()
    return rows


def get_ticket(tid):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM tickets WHERE id=?", (tid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def set_status(tid, status):
    conn = db.get_conn()
    conn.execute("UPDATE tickets SET status=? WHERE id=?", (status, tid))
    conn.commit()
    conn.close()


def delete_ticket(tid):
    conn = db.get_conn()
    conn.execute("DELETE FROM tickets WHERE id=?", (tid,))
    conn.commit()
    conn.close()


def image_paths(ticket):
    """Absolute server paths to a ticket's images (for opening/scp)."""
    base = db.DB_PATH.parent
    return [str(base / p) for p in json.loads(ticket.get("images") or "[]")]


def _cli():
    args = sys.argv[1:]
    if not args or args[0] == "list":
        rows = list_tickets(status=args[1] if len(args) > 1 else None)
        if not rows:
            print("(no tickets)")
            return
        for r in rows:
            n = len(json.loads(r.get("images") or "[]"))
            print(f"#{r['id']:<4} [{r['status']:<4}] {TYPE_HE.get(r['type'], r['type'])}  "
                  f"{r['title']}  · {r['created_at']}" + (f"  · {n} img" if n else ""))
        return
    if args[0] == "show" and len(args) > 1:
        t = get_ticket(int(args[1]))
        if not t:
            print(f"ticket #{args[1]} not found")
            return
        print(f"# Ticket #{t['id']}  ({t['status']})")
        print(f"Type:    {TYPE_HE.get(t['type'], t['type'])}")
        print(f"Title:   {t['title']}")
        print(f"Created: {t['created_at']}")
        print(f"\n{t['body']}\n")
        imgs = image_paths(t)
        if imgs:
            print("Images:")
            for p in imgs:
                print(f"  {p}")
        return
    print("usage: tickets.py [list [status] | show <id>]")


if __name__ == "__main__":
    _cli()
