"""Gmail SMTP email helpers and HTML email templates."""

import html
import io
import logging
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import FRONTEND_URL, GMAIL_APP_PASSWORD, GMAIL_USER


def _send_email(to_addresses: list[str], subject: str, html_body: str) -> None:
    """Send HTML email via Gmail SMTP. Silently skips if credentials not set."""
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        logging.getLogger("hr_portal").warning("Gmail credentials not set — skipping email send.")
        return
    for to in to_addresses:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = f"Sparkcurv HR <{GMAIL_USER}>"
            msg["To"] = to
            msg.set_content("Please view this email in an HTML-capable client.")
            msg.add_alternative(html_body, subtype="html")
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx, timeout=20) as smtp:
                smtp.login(GMAIL_USER, GMAIL_APP_PASSWORD)
                smtp.send_message(msg)
        except Exception as e:
            logging.getLogger("hr_portal").warning(f"Email send failed to {to}: {e}")

def _send_email_with_pdf(to_address: str, subject: str, html_body: str, pdf_buffer: io.BytesIO, filename: str) -> None:
    """Send HTML email with PDF attachment via Gmail SMTP."""
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        logging.getLogger("hr_portal").warning("Gmail credentials not set — skipping payslip email.")
        return
    try:
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.mime.application import MIMEApplication
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = f"Sparkcurv HR <{GMAIL_USER}>"
        msg["To"] = to_address
        alt_part = MIMEMultipart("alternative")
        alt_part.attach(MIMEText("Please view this email in an HTML-capable client.", "plain"))
        alt_part.attach(MIMEText(html_body, "html"))
        msg.attach(alt_part)
        pdf_buffer.seek(0)
        pdf_data = pdf_buffer.read()
        pdf_attach = MIMEApplication(pdf_data, _subtype="pdf")
        pdf_attach.add_header("Content-Disposition", "attachment", filename=filename)
        msg.attach(pdf_attach)
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx, timeout=20) as smtp:
            smtp.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            smtp.sendmail(GMAIL_USER, to_address, msg.as_string())
        logging.getLogger("hr_portal").info(f"Payslip emailed to {to_address}")
    except Exception as e:
        logging.getLogger("hr_portal").warning(f"Payslip email failed to {to_address}: {e}")

# ---------------------------------------------------------------------------
# Shared email layout
#
# Table-based, inline-styled markup only (Gmail / Outlook / Apple Mail safe).
# The header uses a solid navy bgcolor with a CSS gradient layered on top, so
# clients that ignore gradients (Outlook desktop) still get the brand navy.
# ---------------------------------------------------------------------------

_FONT = "Arial,Helvetica,sans-serif"

# accent name -> (strong colour, tinted box background, tinted box border, pill text on dark header)
_ACCENTS = {
    "blue": ("#0020F8", "#EEF3FF", "#D6E0FF", "#7DD3FC"),
    "red": ("#DC2626", "#FEF2F2", "#FECACA", "#FCA5A5"),
    "green": ("#16A34A", "#F0FDF4", "#BBF7D0", "#86EFAC"),
    "amber": ("#D97706", "#FFFBEB", "#FDE68A", "#FCD34D"),
}


def _login_url() -> str:
    return f"{FRONTEND_URL.rstrip('/')}/login"


def _logo_url() -> str:
    return f"{FRONTEND_URL.rstrip('/')}/sparkcurv-logo-full.png"


def _email_layout(title: str, body_html: str, *, eyebrow: str = "", accent: str = "blue") -> str:
    """Wrap body_html in the branded Sparkcurv HR Portal shell.

    title / eyebrow must already be HTML-safe. accent is one of _ACCENTS.
    """
    strong, _, _, pill = _ACCENTS.get(accent, _ACCENTS["blue"])
    bar = "#7DD3FC" if strong == _ACCENTS["blue"][0] else strong  # blue-on-blue would vanish; use sky
    eyebrow_html = (
        f'<p style="margin:0 0 10px;font-family:{_FONT};font-size:11px;font-weight:700;'
        f'letter-spacing:2px;text-transform:uppercase;color:{pill}">{eyebrow}</p>'
        if eyebrow else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title></head>
<body style="margin:0;padding:0;background:#EEF2FB;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2FB" style="background:#EEF2FB">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px 16px 0 0;padding:22px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><img src="{_logo_url()}" width="180" alt="Sparkcurv" style="display:block;width:180px;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;font-family:{_FONT};font-size:22px;font-weight:700;letter-spacing:1px;color:#0B1E5B"></td>
      <td valign="middle" align="right" style="font-family:{_FONT};font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0020F8">HR&nbsp;Portal</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#0B1E5B" style="background-color:#0B1E5B;background-image:linear-gradient(135deg,#071340 0%,#0B1E5B 40%,#0020F8 72%,#4D6BFF 100%);padding:30px 36px 32px">
    {eyebrow_html}
    <h1 style="margin:0;font-family:{_FONT};font-size:26px;line-height:32px;font-weight:700;color:#FFFFFF">{title}</h1>
  </td></tr>
  <tr><td bgcolor="{bar}" style="background:{bar};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 36px 36px;border-radius:0 0 16px 16px;font-family:{_FONT};font-size:15px;line-height:24px;color:#334155">
    {body_html}
  </td></tr>
  <tr><td align="center" style="padding:22px 24px 0;font-family:{_FONT};font-size:12px;line-height:18px;color:#64748B">
    <strong style="color:#0B1E5B">Sparkcurv HR Portal</strong> &middot; Automated notification &mdash; please do not reply.<br>
    <span style="color:#94A3B8">Sparkcurv Technologies Pvt Limited</span>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def _email_field(label: str, value_html: str, *, size: int = 15, weight: int = 400,
                 color: str = "#0F172A", last: bool = False) -> str:
    """One label/value pair inside an info box. Both arguments must already be HTML-safe."""
    return (
        f'<p style="margin:0 0 4px;font-family:{_FONT};font-size:11px;font-weight:700;color:#64748B;'
        f'text-transform:uppercase;letter-spacing:1.2px">{label}</p>'
        f'<p style="margin:0 0 {0 if last else 18}px;font-family:{_FONT};font-size:{size}px;line-height:1.55;'
        f'font-weight:{weight};color:{color}">{value_html}</p>'
    )


def _email_info_box(inner_html: str, accent: str = "blue") -> str:
    """Soft tinted card with a coloured left rule."""
    strong, tint, border, _ = _ACCENTS.get(accent, _ACCENTS["blue"])
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate">
  <tr><td bgcolor="{tint}" style="background:{tint};border:1px solid {border};border-left:4px solid {strong};border-radius:12px;padding:22px 24px">
    {inner_html}
  </td></tr>
</table>"""


def _email_button(label: str = "Login to Portal") -> str:
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0"><tr>
  <td bgcolor="#0020F8" style="background:#0020F8;border-radius:10px">
    <a href="{_login_url()}" style="display:inline-block;padding:14px 30px;font-family:{_FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px">{label} &rarr;</a>
  </td>
</tr></table>"""


def _email_paragraph(text_html: str, *, margin: str = "28px 0 20px", size: int = 15, color: str = "#334155") -> str:
    return f'<p style="margin:{margin};font-family:{_FONT};font-size:{size}px;line-height:1.6;color:{color}">{text_html}</p>'


def _emergency_clockout_email_html(employee_name: str, reason: str, working_hours: float, date_str: str) -> str:
    box = _email_info_box(
        _email_field("Employee", html.escape(employee_name), size=18, weight=700)
        + _email_field("Date", f"{html.escape(str(date_str))} &mdash; logged out after <strong>{working_hours}h</strong>")
        + _email_field("Reason", html.escape(reason), last=True),
        accent="red",
    )
    body = (
        box
        + _email_paragraph("Your direct report used <strong>Emergency Logout</strong> before completing the required "
                           "work hours. Log in to the HR Portal to review their attendance record.")
        + _email_button()
    )
    return _email_layout("Emergency Logout Alert", body, eyebrow="Attendance alert", accent="red")


def _cr_email_html(cr: dict, reviewer_label: str) -> str:
    """Build a notify-only CR email — no action links. Approval must happen after portal login."""
    priority_color = {"high": "#DC2626", "medium": "#D97706", "low": "#16A34A"}.get(
        (cr.get("priority") or "medium").lower(), "#D97706"
    )
    def meta_cell(label: str, value: str, color: str = "#0F172A", weight: int = 600) -> str:
        return (
            '<td valign="top" style="padding:0 24px 0 0">'
            f'<p style="margin:0 0 4px;font-family:{_FONT};font-size:11px;font-weight:700;color:#64748B;'
            f'text-transform:uppercase;letter-spacing:1.2px">{label}</p>'
            f'<p style="margin:0;font-family:{_FONT};font-size:14px;font-weight:{weight};color:{color}">{value}</p></td>'
        )

    meta = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        + meta_cell("Type", html.escape(str(cr.get("cr_type", "General"))))
        + meta_cell("Priority", html.escape(str(cr.get("priority", "medium")).upper()), color=priority_color, weight=700)
        + meta_cell("Submitted by", html.escape(str(cr.get("requester_name", ""))))
        + "</tr></table>"
    )
    box = _email_info_box(
        _email_field("Title", html.escape(str(cr.get("title", ""))), size=18, weight=700)
        + _email_field("Description", html.escape(str(cr.get("description", ""))), color="#334155")
        + meta
    )
    body = (
        f'<p style="margin:0 0 4px;font-family:{_FONT};font-size:11px;font-weight:700;color:#64748B;'
        'text-transform:uppercase;letter-spacing:1.2px">Change Request ID</p>'
        f'<p style="margin:0 0 22px;font-family:{_FONT};font-size:24px;font-weight:700;color:#0020F8;letter-spacing:1px">'
        f'{html.escape(str(cr.get("cr_number", "CR-????")))}</p>'
        + box
        + _email_paragraph(f"As a <strong>{reviewer_label}</strong>, please log in to the HR Portal to review and take "
                           "action on this request.")
        + _email_button()
        + _email_paragraph("For security, approval or rejection can only be done after logging in to the portal.",
                           margin="22px 0 0", size=12, color="#94A3B8")
    )
    return _email_layout("Change Request", body, eyebrow="Review needed")


def _request_email_html(heading: str, employee_name: str, fields: list[tuple[str, str]],
                        message: str = "Log in to the HR Portal to review this request.") -> str:
    """Notification email for a leave / permission request or its decision. Values are HTML-escaped."""
    lowered = heading.lower()
    accent = "green" if "approved" in lowered else "red" if "rejected" in lowered else "blue"
    eyebrow = {"green": "Approved", "red": "Rejected"}.get(accent, "Action required")
    strong = _ACCENTS[accent][0]
    rows = "".join(
        _email_field(
            html.escape(label),
            html.escape(str(value)),
            weight=700 if label == "Status" else 400,
            color=strong if label == "Status" and accent != "blue" else "#0F172A",
            last=i == len(fields) - 1,
        )
        for i, (label, value) in enumerate(fields)
    )
    box = _email_info_box(
        _email_field("Employee", html.escape(employee_name), size=18, weight=700, last=not fields) + rows,
        accent=accent,
    )
    body = box + _email_paragraph(html.escape(message)) + _email_button()
    return _email_layout(html.escape(heading), body, eyebrow=eyebrow, accent=accent)


def _payslip_email_html(ps: dict) -> str:
    """Email body sent with a payslip PDF attached (gross, deductions, net pay)."""
    logo_url = f"{FRONTEND_URL.rstrip('/')}/sparkcurv-logo-full.png"
    name = html.escape(str(ps.get("employee_name") or ""))
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payslip — {ps['month_name']} {ps['year']}</title></head>
<body style="margin:0;padding:0;background:#EEF2FB">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EEF2FB" style="background:#EEF2FB">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:16px 16px 0 0;padding:22px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle"><img src="{logo_url}" width="180" alt="Sparkcurv" style="display:block;width:180px;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;letter-spacing:1px;color:#0B1E5B"></td>
      <td valign="middle" align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#0020F8">HR&nbsp;Portal</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="#0B1E5B" style="background-color:#0B1E5B;background-image:linear-gradient(135deg,#071340 0%,#0B1E5B 40%,#0020F8 72%,#4D6BFF 100%);padding:30px 36px 32px">
    <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#7DD3FC">Payroll</p>
    <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:#FFFFFF">Payslip &mdash; {ps['month_name']} {ps['year']}</h1>
  </td></tr>
  <tr><td bgcolor="#7DD3FC" style="background:#7DD3FC;height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 36px 36px;border-radius:0 0 16px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#334155">
    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#334155">Dear <strong style="color:#0F172A">{name}</strong>,</p>
    <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#334155">Please find attached your payslip for <strong style="color:#0F172A">{ps['month_name']} {ps['year']}</strong>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid #D6E0FF;border-radius:12px">
      <tr>
        <td bgcolor="#F8FAFF" style="background:#F8FAFF;padding:14px 20px;border-bottom:1px solid #E2E8F0;border-radius:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748B">Gross Salary</td>
        <td bgcolor="#F8FAFF" align="right" style="background:#F8FAFF;padding:14px 20px;border-bottom:1px solid #E2E8F0;border-radius:0 12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#0F172A">₹{(ps.get('basic_salary') or 0):,.2f}</td>
      </tr>
      <tr>
        <td style="padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#64748B">Total Deductions</td>
        <td align="right" style="padding:14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#DC2626">-₹{(ps.get('total_deductions') or 0):,.2f}</td>
      </tr>
      <tr>
        <td bgcolor="#0020F8" style="background:#0020F8;padding:18px 20px;border-radius:0 0 0 11px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#7DD3FC">Net Pay</td>
        <td bgcolor="#0020F8" align="right" style="background:#0020F8;padding:18px 20px;border-radius:0 0 11px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#FFFFFF">₹{(ps.get('net_pay') or 0):,.2f}</td>
      </tr>
    </table>
    <p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#64748B">The full payslip PDF is attached to this email.</p>
  </td></tr>
  <tr><td align="center" style="padding:22px 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#64748B">
    <strong style="color:#0B1E5B">Sparkcurv HR Portal</strong> &middot; Automated message &mdash; please do not reply.<br>
    <span style="color:#94A3B8">Sparkcurv Technologies Pvt Limited</span>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def _login_reminder_email_html(employee_name: str, date_str: str, reminder_time: str) -> str:
    """Weekday morning reminder for someone who hasn't logged in yet."""
    box = _email_info_box(
        _email_field("Employee", html.escape(employee_name), size=18, weight=700)
        + _email_field("Date", html.escape(date_str))
        + _email_field("Status", f"Not logged in as of {html.escape(reminder_time)}", color="#B45309", weight=700, last=True),
        accent="amber",
    )
    body = (
        box
        + _email_paragraph("Your workday hasn't been started in the HR Portal yet. Please log in now so your hours are "
                           "recorded. If you're on leave or working from home today, make sure it's approved in the portal.")
        + _email_button("Log in now")
    )
    return _email_layout("Login reminder", body, eyebrow="Attendance", accent="amber")


def _logout_reminder_email_html(employee_name: str, date_str: str, login_time: str, worked: str) -> str:
    """Sent once the required hours are complete while the employee is still logged in."""
    box = _email_info_box(
        _email_field("Employee", html.escape(employee_name), size=18, weight=700)
        + _email_field("Date", html.escape(date_str))
        + _email_field("Logged in at", html.escape(login_time))
        + _email_field("Worked today", html.escape(worked), color="#15803D", weight=700, last=True),
        accent="green",
    )
    body = (
        box
        + _email_paragraph("The required hours for today are complete. Don't forget to <strong>log out</strong> in the "
                           "HR Portal when you finish, so today's attendance is recorded correctly.")
        + _email_button("Log out in the portal")
    )
    return _email_layout("Your hours are complete", body, eyebrow="Attendance", accent="green")

