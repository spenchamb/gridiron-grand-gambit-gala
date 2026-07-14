#!/usr/bin/env python3
"""Email a summary of the most recent changelog entry.
Run after updating sleeper/data/changelog.json so every site change notifies.
Usage:  python3 sc-changelog-notify.py

Secrets (GMAIL_USER, GMAIL_PASS) are read from the environment or from a
git-ignored secrets file (default /boot/config/secrets.env, override with
$SECRETS_ENV). Never hardcode credentials in this file — it is committed to git.
"""
import json
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def _load_secrets(path=None):
    path = path or os.environ.get("SECRETS_ENV", "/boot/config/secrets.env")
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


_load_secrets()
GMAIL_USER = os.environ["GMAIL_USER"]
GMAIL_PASS = os.environ["GMAIL_PASS"]
TO         = os.environ.get("NOTIFY_TO", GMAIL_USER)
CHANGELOG  = "/mnt/cache/appdata/www-data/sleeper/data/changelog.json"
URL        = "https://scbl.ink/sleeper/changelog.html"
ACCENT     = "#5b8dd9"
TAGS = {"feature": "#5b8dd9", "fix": "#c9893a", "infra": "#8a7fb5", "docs": "#2a2a30"}

with open(CHANGELOG) as f:
    en = json.load(f)["entries"][0]

items = "".join(
    f'<li style="margin-bottom:10px;color:#c7c2b6;line-height:1.55">'
    f'<b style="color:#ddd8cc">{it["h"]}.</b> {it["d"]}</li>'
    for it in en.get("items", []))
tag_color = TAGS.get(en.get("tag"), "#2a2a30")

html = f"""<!DOCTYPE html><html><body style="margin:0;background:#0e0e10;
font-family:'JetBrains Mono',ui-monospace,monospace;color:#ddd8cc;padding:32px 16px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;
background:#16161a;border:1px solid #2a2a30;border-radius:16px;padding:28px 32px;">
<tr><td>
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;
color:{ACCENT};font-weight:bold;">GGGG &middot; Site Update</p>
<span style="display:inline-block;font-size:10px;font-weight:bold;text-transform:uppercase;
letter-spacing:.06em;padding:3px 9px;border-radius:5px;background:{tag_color};color:#0e0e10;">
{en.get("tag","update")}</span>
<span style="font-size:12px;color:#7a7570;margin-left:8px;">{en.get("date","")}</span>
<h1 style="margin:10px 0 8px;font-size:22px;color:#ddd8cc;">{en["title"]}</h1>
<p style="font-size:14px;color:#9a948a;margin:0 0 16px;">{en.get("summary","")}</p>
<ul style="padding-left:18px;margin:0;font-size:14px;">{items}</ul>
<p style="margin:22px 0 0;border-top:1px solid #2a2a30;padding-top:14px;">
<a href="{URL}" style="color:{ACCENT};text-decoration:none;font-weight:bold;">View the full changelog &rarr;</a></p>
</td></tr></table></td></tr></table></body></html>"""

msg = MIMEMultipart("alternative")
msg["Subject"] = f"GGGG site update: {en['title']}"
msg["From"] = GMAIL_USER
msg["To"] = TO
msg.attach(MIMEText(html, "html"))
with smtplib.SMTP("smtp.gmail.com", 587) as s:
    s.starttls()
    s.login(GMAIL_USER, GMAIL_PASS)
    s.sendmail(GMAIL_USER, TO, msg.as_string())
print("emailed changelog:", en["title"])
