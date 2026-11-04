"""Client-facing PDFs on the Sparkcurv letterhead (reportlab): commercial proposal, scope of work, agreement and tax invoice.
Never include costs or margins. Company details come from ``app.core.config`` (COMPANY_*).

Text fields (scope of work, terms) may use ``## Heading`` lines to start a numbered section, ``- `` lines for bullets and blank lines between paragraphs."""

import io
import os
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core import config as cfg

BRAND = colors.HexColor("#2D3BF0")
INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#E2E8F0")
ZEBRA = colors.HexColor("#F8FAFC")
TINT = colors.HexColor("#E6ECFA")
W, H = A4
MARGIN = 20 * mm

TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=20, textColor=BRAND, leading=24, alignment=1)
SUBTITLE = ParagraphStyle("subtitle", fontName="Helvetica", fontSize=10.5, textColor=MUTED, leading=14, alignment=1)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, textColor=BRAND, leading=16, spaceBefore=10, spaceAfter=3)
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9.8, textColor=INK, leading=14, alignment=4)
BODY_L = ParagraphStyle("bodyl", parent=BODY, alignment=0)
BULLET = ParagraphStyle("bullet", parent=BODY, leftIndent=12, bulletIndent=2, spaceAfter=1)
SMALL = ParagraphStyle("small", fontName="Helvetica", fontSize=8.3, textColor=MUTED, leading=11)
CELL = ParagraphStyle("cell", fontName="Helvetica", fontSize=9.3, textColor=INK, leading=12)
CELL_B = ParagraphStyle("cellb", parent=CELL, fontName="Helvetica-Bold")


def company() -> dict:
    return {"name": cfg.COMPANY_LEGAL_NAME, "website": cfg.COMPANY_WEBSITE, "address": cfg.COMPANY_ADDRESS, "tagline": cfg.COMPANY_TAGLINE,
            "email": cfg.COMPANY_SALES_EMAIL, "phone": cfg.COMPANY_PHONE, "gstin": cfg.COMPANY_GSTIN, "bank": cfg.COMPANY_BANK_DETAILS}


def _money(value) -> str:
    return f"{float(value):,.2f}"


def _text(value: str) -> str:
    return escape(value or "").replace("\n", "<br/>")


def _fmt_date(value) -> str:
    if not value:
        return "—"
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d-%b-%Y")
    except ValueError:
        return str(value)


# ------------------------------------------------------------------ letterhead

def _page(co: dict, ref: str):
    """Header (logo, website + address, tagline, rule) and footer (contact block, page number, wave) drawn on every page."""
    logo = os.path.join(cfg.ROOT_DIR, "uploads", "sparkcurv-logo-full.png")

    def draw(canvas, doc):
        canvas.saveState()
        top = H - 14 * mm
        if os.path.exists(logo):
            try:
                img = ImageReader(logo)
                iw, ih = img.getSize()
                w = 52 * mm
                canvas.drawImage(img, MARGIN - 2 * mm, top - w * ih / iw, width=w, height=w * ih / iw, mask="auto")
            except Exception:
                canvas.setFont("Helvetica-Bold", 16); canvas.setFillColor(BRAND); canvas.drawString(MARGIN, top - 8 * mm, "SPARKCURV")
        else:
            canvas.setFont("Helvetica-Bold", 16); canvas.setFillColor(BRAND); canvas.drawString(MARGIN, top - 8 * mm, "SPARKCURV")
        canvas.setFont("Helvetica", 8.8); canvas.setFillColor(BRAND)
        canvas.drawRightString(W - MARGIN, top - 2 * mm, co["website"])
        canvas.setFillColor(INK)
        parts = [p.strip() for p in co["address"].split(",")]
        lines, cur = [], ""
        for part in parts:                                    # wrap the address into short right-aligned lines
            if len(cur) + len(part) > 34 and cur:
                lines.append(cur.rstrip(",")); cur = ""
            cur += part + ", "
        lines.append(cur.rstrip(", "))
        for i, line in enumerate(lines[:3]):
            canvas.drawRightString(W - MARGIN, top - 6.5 * mm - i * 4 * mm, line.rstrip(","))
        canvas.setFont("Helvetica", 8.6); canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, top - 22 * mm, co["tagline"])
        canvas.setStrokeColor(BRAND); canvas.setLineWidth(1.2); canvas.line(MARGIN, top - 25 * mm, W - MARGIN, top - 25 * mm)
        # footer: wave, contact block, page number
        canvas.setFillColor(colors.HexColor("#EAF0FF"))
        p = canvas.beginPath(); p.moveTo(W * 0.55, 0); p.curveTo(W * 0.75, 9 * mm, W * 0.9, 13 * mm, W, 15 * mm); p.lineTo(W, 0); p.close(); canvas.drawPath(p, fill=1, stroke=0)
        canvas.setFillColor(BRAND)
        p = canvas.beginPath(); p.moveTo(0, 0); p.lineTo(0, 7 * mm); p.curveTo(W * 0.35, 9 * mm, W * 0.7, 6 * mm, W, 13 * mm); p.lineTo(W, 0); p.close(); canvas.drawPath(p, fill=1, stroke=0)
        canvas.setFillColor(BRAND); canvas.rect(MARGIN - 3 * mm, 16 * mm, 1.2 * mm, 8 * mm, fill=1, stroke=0)
        canvas.setFillColor(INK); canvas.setFont("Helvetica-Bold", 8.2); canvas.drawString(MARGIN, 21.4 * mm, "Email:")
        canvas.setFont("Helvetica", 8.2); canvas.drawString(MARGIN + 9.5 * mm, 21.4 * mm, co["email"])
        canvas.setFont("Helvetica-Bold", 8.2); canvas.drawString(MARGIN, 17.4 * mm, "Location:")
        canvas.setFont("Helvetica", 8.2); canvas.drawString(MARGIN + 13.5 * mm, 17.4 * mm, "Nagercoil, Tamil Nadu" if "Nagercoil" in co["address"] else co["address"].split(",")[-2].strip() if "," in co["address"] else co["address"])
        canvas.setFont("Helvetica-Bold", 8.2); canvas.setFillColor(BRAND); canvas.drawString(MARGIN + 60 * mm, 17.4 * mm, "Mobile:")
        canvas.setFont("Helvetica", 8.2); canvas.setFillColor(INK); canvas.drawString(MARGIN + 71 * mm, 17.4 * mm, co["phone"])
        canvas.setFont("Helvetica", 7.5); canvas.setFillColor(MUTED); canvas.drawRightString(W - MARGIN, 24 * mm, f"{ref}  ·  Page {doc.page}")
        canvas.restoreState()
    return draw


def _doc(buf, title: str, ref: str, co: dict):
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=44 * mm, bottomMargin=32 * mm, leftMargin=MARGIN - 6, rightMargin=MARGIN - 6, title=title, author=co["name"])
    return doc, _page(co, ref)


def _to_from(client: dict, co: dict):
    """The 'To / From' address blocks."""
    to = [Paragraph(f"<b>{escape(client['name'])}</b>", BODY_L)]
    address = client.get("billing_address") or client.get("address")
    if address:
        to.append(Paragraph(_text(address), BODY_L))
    if client.get("gstin"):
        to.append(Paragraph(f"GSTIN: {escape(client['gstin'])}", BODY_L))
    frm = [Paragraph(f"<b>{escape(co['name'])}</b>", BODY_L), Paragraph(_text(co["address"]), BODY_L), Paragraph(f"Mobile: {escape(co['phone'])}", BODY_L)]
    t = Table([[Paragraph("<b>To</b>", BODY_L), to], [Paragraph("<b>From</b>", BODY_L), frm]], colWidths=[16 * mm, 154 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 1)]))
    return t


def _ref_line(*pairs):
    return Paragraph("&nbsp;&nbsp;&nbsp;&nbsp;".join(f"<b>{escape(k)}:</b> {escape(str(v))}" for k, v in pairs if v), BODY_L)


# ------------------------------------------------------------------ text -> flowables

def parse_sections(text: str) -> list:
    """[(heading or None, body)] — ``## Heading`` starts a section; text before the first heading has heading None."""
    out, head, buf = [], None, []
    for line in (text or "").replace("\r", "").split("\n"):
        if line.startswith("## "):
            if head is not None or "".join(buf).strip():
                out.append((head, "\n".join(buf).strip()))
            head, buf = line[3:].strip(), []
        else:
            buf.append(line)
    if head is not None or "".join(buf).strip():
        out.append((head, "\n".join(buf).strip()))
    return out


def _body(text: str) -> list:
    """Paragraphs separated by blank lines; lines starting with '- ' or '• ' become bullets."""
    els = []
    for block in (text or "").split("\n\n"):
        lines = [l for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        if all(l.lstrip().startswith(("- ", "• ")) for l in lines):
            els += [Paragraph(escape(l.lstrip()[2:].strip()), BULLET, bulletText="•") for l in lines]
        else:
            els.append(Paragraph(_text("\n".join(lines)), BODY))
        els.append(Spacer(1, 2 * mm))
    return els


def _numbered(sections: list, start: int, default_heading: str) -> tuple:
    """Flowables for ``sections`` numbered from ``start``; unheaded text gets ``default_heading``. Returns (flowables, next number)."""
    els, n = [], start
    for head, body in sections:
        els.append(Paragraph(f"{n}. {escape(head or default_heading)}", H2))
        els += _body(body)
        n += 1
    return els, n


def _signatures(left: str, right: str):
    def cell(who):
        return [Paragraph(f"<b>For {escape(who)}</b>", BODY_L), Spacer(1, 2 * mm), Paragraph("Authorised Signatory", BODY_L), Spacer(1, 9 * mm),
                Paragraph("Name: ______________________", BODY_L), Spacer(1, 2 * mm), Paragraph("Date: ______________________", BODY_L)]
    t = Table([[cell(left), cell(right)]], colWidths=[85 * mm, 85 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return KeepTogether([Spacer(1, 8 * mm), t])


def _table_style(n_rows: int, total_rows: int = 1, right_from: int = 1):
    style = [("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9.3),
             ("ALIGN", (right_from, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
             ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE)]
    style += [("BACKGROUND", (0, n_rows - total_rows), (-1, n_rows - 1), TINT), ("FONTNAME", (0, n_rows - total_rows), (-1, n_rows - 1), "Helvetica-Bold")]
    return TableStyle(style)


# ------------------------------------------------------------------ documents

def generate_proposal_pdf(proposal: dict, items: list, client: dict, _company=None) -> io.BytesIO:
    """Commercial proposal. ``proposal``: code, title, terms, scope_of_work, valid_until, total_amount (before GST), tax_pct, created_at; ``items``: description, quantity, unit, rate."""
    co = company()
    buf = io.BytesIO()
    doc, page = _doc(buf, f"Commercial Proposal {proposal['code']}", proposal["code"], co)
    els = [Paragraph("COMMERCIAL PROPOSAL", TITLE), Paragraph(escape(proposal["title"]), SUBTITLE), Spacer(1, 5 * mm),
           _ref_line(("Reference No.", proposal["code"]), ("Date", _fmt_date(proposal.get("created_at"))), ("Valid until", _fmt_date(proposal["valid_until"]) if proposal.get("valid_until") else "")), Spacer(1, 3 * mm),
           _to_from(client, co), Spacer(1, 2 * mm), Paragraph("Dear Sir/Madam,", BODY_L), Spacer(1, 2 * mm),
           Paragraph(f"Thank you for the opportunity. We are pleased to set out our commercial proposal for <b>{escape(proposal['title'])}</b> below. "
                     f"The Scope of Work forms an integral part of this proposal.", BODY)]
    # 1. Commercial value
    tax_pct = float(proposal.get("tax_pct") if proposal.get("tax_pct") is not None else 18)
    subtotal = float(proposal["total_amount"])
    tax = round(subtotal * tax_pct / 100, 2)
    plain = all(float(i["quantity"]) == 1 and not (i.get("unit") or "").strip() for i in items)
    els += [Paragraph("1. Commercial Value", H2)]
    if plain:
        rows = [["Description", "Amount (INR)"]] + [[Paragraph(escape(i["description"]), CELL), _money(float(i["quantity"]) * float(i["rate"]))] for i in items]
        rows += [[f"GST @ {tax_pct:g}%", _money(tax)], ["Total Proposal Value", _money(subtotal + tax)]]
        widths = [124 * mm, 46 * mm]
    else:
        rows = [["Description", "Qty", "Rate", "Amount (INR)"]] + [[Paragraph(escape(i["description"]), CELL), f"{float(i['quantity']):g} {escape(i.get('unit') or '')}".strip(), _money(i["rate"]), _money(float(i["quantity"]) * float(i["rate"]))] for i in items]
        rows += [["", "", f"GST @ {tax_pct:g}%", _money(tax)], ["", "", "Total", _money(subtotal + tax)]]
        widths = [78 * mm, 24 * mm, 32 * mm, 36 * mm]
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(_table_style(len(rows), 1, 1 if plain else 1))
    els += [t, Spacer(1, 1.5 * mm), Paragraph("All figures in Indian Rupees (INR). GST is charged at the rate prevailing on the date of invoicing.", SMALL)]
    # 2. Scope, then every terms section
    n = 2
    scope = parse_sections(proposal.get("scope_of_work") or "")
    if scope:
        flow, _ = _numbered([(None, "\n\n".join(b for _, b in scope))] if all(h is None for h, _ in scope) else scope, n, "Scope of Work")
        els += flow; n += len(scope) if any(h for h, _ in scope) else 1
    else:
        els += [Paragraph(f"{n}. Scope of Work", H2), Paragraph("The detailed Scope of Work will be issued as a separate Scope Document and will be read together with this proposal.", BODY)]; n += 1
    flow, n = _numbered(parse_sections(proposal.get("terms") or ""), n, "Terms & Conditions")
    els += flow
    if proposal.get("valid_until"):
        els += [Spacer(1, 3 * mm), Paragraph(f"This proposal is valid until {_fmt_date(proposal['valid_until'])} unless otherwise agreed in writing.", BODY)]
    els.append(_signatures(co["name"], client["name"]))
    doc.build(els, onFirstPage=page, onLaterPages=page)
    buf.seek(0)
    return buf


def generate_scope_pdf(contract: dict, client: dict, proposal_code: str = "") -> io.BytesIO:
    """Scope Document issued once the PO is received. ``contract``: code, contract_no, po_reference, po_date, start_date, end_date, scope_of_work."""
    co = company()
    buf = io.BytesIO()
    ref = contract.get("contract_no") or contract["code"]
    doc, page = _doc(buf, f"Scope of Work {ref}", ref, co)
    els = [Paragraph("SCOPE OF WORK", TITLE), Paragraph("Scope Document", SUBTITLE), Spacer(1, 5 * mm),
           _ref_line(("Reference No.", ref), ("PO No.", contract.get("po_reference")), ("PO Date", _fmt_date(contract.get("po_date")) if contract.get("po_date") else "")), Spacer(1, 3 * mm),
           _to_from(client, co), Spacer(1, 2 * mm),
           Paragraph("This Scope Document sets out the work covered by the Purchase Order above" + (f" and is to be read together with Commercial Proposal {escape(proposal_code)}." if proposal_code else "."), BODY)]
    if contract.get("start_date"):
        els += [Spacer(1, 2 * mm), Paragraph(f"<b>Effective Date:</b> {_fmt_date(contract['start_date'])}" + (f" &nbsp;&nbsp; <b>Until:</b> {_fmt_date(contract['end_date'])}" if contract.get("end_date") else ""), BODY_L)]
    sections = parse_sections(contract.get("scope_of_work") or "") or [(None, "The scope is as described in the accepted Commercial Proposal.")]
    flow, _ = _numbered(sections, 1, "Scope of Work")
    els += flow
    els.append(_signatures(co["name"], client["name"]))
    doc.build(els, onFirstPage=page, onLaterPages=page)
    buf.seek(0)
    return buf


def generate_agreement_pdf(contract: dict, client: dict, _company=None) -> io.BytesIO:
    """Service agreement drawn from a contract: parties, commercials, period, scope, terms and signature blocks."""
    co = company()
    buf = io.BytesIO()
    ref = contract.get("contract_no") or contract["code"]
    doc, page = _doc(buf, f"Agreement {contract['code']}", ref, co)
    els = [Paragraph("SERVICE AGREEMENT", TITLE), Paragraph(escape(ref), SUBTITLE), Spacer(1, 5 * mm), _to_from(client, co), Spacer(1, 3 * mm)]
    facts = [["Contract", escape(contract["code"])], ["Client PO", f"{escape(contract.get('po_reference') or '—')}  ({_fmt_date(contract.get('po_date'))})"],
             ["Contract value", _money(contract["contract_value"]) + " (excluding GST)"], ["Period", f"{_fmt_date(contract.get('start_date'))}  to  {_fmt_date(contract.get('end_date')) if contract.get('end_date') else 'open-ended'}"]]
    t = Table([[Paragraph(f"<b>{k}</b>", CELL), Paragraph(v, CELL)] for k, v in facts], colWidths=[40 * mm, 130 * mm])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    els.append(t)
    n = 1
    flow, n = _numbered(parse_sections(contract.get("scope_of_work") or "") or [(None, "As described in the accepted proposal.")], n, "Scope of Work")
    els += flow
    flow, n = _numbered(parse_sections(contract.get("agreement_terms") or "") or [(None, "As set out in the accepted proposal and the client purchase order.")], n, "Terms & Conditions")
    els += flow
    els.append(_signatures(co["name"], client["name"]))
    doc.build(els, onFirstPage=page, onLaterPages=page)
    buf.seek(0)
    return buf


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _below_1000(n: int) -> str:
    out = []
    if n >= 100:
        out.append(_ONES[n // 100] + " Hundred"); n %= 100
    if n >= 20:
        out.append(_TENS[n // 10] + ((" " + _ONES[n % 10]) if n % 10 else ""))
    elif n:
        out.append(_ONES[n])
    return " ".join(out)


def rupees_in_words(amount) -> str:
    """Indian numbering (lakh / crore): 70800.50 -> 'Rupees Seventy Thousand Eight Hundred and Fifty Paise Only'."""
    rupees, paise = divmod(int(round(float(amount) * 100)), 100)
    parts = []
    for unit, size in (("Crore", 10 ** 7), ("Lakh", 10 ** 5), ("Thousand", 1000)):
        q, rupees = divmod(rupees, size)
        if q:
            parts.append(f"{_below_1000(q)} {unit}")
    if rupees:
        parts.append(_below_1000(rupees))
    words = "Rupees " + (" ".join(parts) or "Zero")
    if paise:
        words += f" and {_below_1000(paise)} Paise"
    return words + " Only"


def generate_invoice_pdf(invoice: dict, client: dict, contract: dict) -> io.BytesIO:
    """Tax invoice. ``invoice``: code, period, invoice_date, gross_amount, tax_pct, tax_amount, tds_pct, tds_amount, retention_pct, retention_amount, net_amount, status, notes, cancel_reason;
    ``contract``: code, contract_no, po_reference, po_date."""
    co = company()
    buf = io.BytesIO()
    doc, page = _doc(buf, f"Invoice {invoice['code']}", invoice["code"], co)
    status = invoice.get("status")
    els = [Paragraph("TAX INVOICE", TITLE)]
    if status != "POSTED":
        els.append(Paragraph(f"<font color='#B91C1C'><b>{'DRAFT — not yet issued' if status == 'DRAFT' else 'CANCELLED'}</b></font>", SUBTITLE))
    els += [Spacer(1, 4 * mm), _ref_line(("Invoice No.", invoice["code"]), ("Date", _fmt_date(invoice.get("invoice_date"))), ("Period", invoice.get("period"))), Spacer(1, 1.5 * mm),
            _ref_line(("Contract", contract.get("contract_no") or contract["code"]), ("PO No.", contract.get("po_reference")), ("PO Date", _fmt_date(contract.get("po_date")) if contract.get("po_date") else "")), Spacer(1, 3 * mm)]
    if co["gstin"]:
        els += [Paragraph(f"<b>Our GSTIN:</b> {escape(co['gstin'])}", BODY_L), Spacer(1, 1.5 * mm)]
    els += [_to_from(client, co), Spacer(1, 3 * mm)]
    desc = f"Services for {invoice.get('period')} under contract {contract.get('contract_no') or contract['code']}" + (f" (PO {contract['po_reference']})" if contract.get("po_reference") else "")
    rows = [["Description", "Amount (INR)"], [Paragraph(escape(desc), CELL), _money(invoice["gross_amount"])], [f"GST @ {float(invoice['tax_pct']):g}%", _money(invoice["tax_amount"])],
            ["Invoice Total", _money(float(invoice["gross_amount"]) + float(invoice["tax_amount"]))]]
    total_rows = 1
    deductions = []
    if float(invoice["tds_amount"]):
        deductions.append([f"Less: TDS @ {float(invoice['tds_pct']):g}%", "- " + _money(invoice["tds_amount"])])
    if float(invoice["retention_amount"]):
        deductions.append([f"Less: Retention @ {float(invoice['retention_pct']):g}%", "- " + _money(invoice["retention_amount"])])
    if deductions:
        rows += deductions + [["Net Payable", _money(invoice["net_amount"])]]
    t = Table(rows, colWidths=[124 * mm, 46 * mm], repeatRows=1)
    style = _table_style(len(rows), 1)
    if deductions:   # the invoice total row is a subtotal; only the last row is highlighted
        style.add("BACKGROUND", (0, 3), (-1, 3), colors.white); style.add("FONTNAME", (0, 3), (-1, 3), "Helvetica-Bold")
    t.setStyle(style)
    els += [t, Spacer(1, 2 * mm), Paragraph(f"<b>Amount payable in words:</b> {escape(rupees_in_words(invoice['net_amount']))}", BODY_L)]
    if invoice.get("notes"):
        els += [Spacer(1, 3 * mm), Paragraph(f"<b>Notes:</b> {_text(invoice['notes'])}", BODY_L)]
    if co["bank"]:
        els += [Paragraph("Bank details for payment", H2), Paragraph(_text(co["bank"]), BODY_L)]
    els += [Spacer(1, 4 * mm), Paragraph("Amounts are in Indian Rupees (INR). Please quote the invoice number with your payment.", SMALL), Spacer(1, 10 * mm),
            Paragraph(f"For <b>{escape(co['name'])}</b>", BODY_L), Spacer(1, 10 * mm), Paragraph("Authorised Signatory", BODY_L)]
    doc.build(els, onFirstPage=page, onLaterPages=page)
    buf.seek(0)
    return buf
