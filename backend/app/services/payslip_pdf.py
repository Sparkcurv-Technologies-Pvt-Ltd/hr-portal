"""Payslip PDF rendering with ReportLab."""

import io
import os
import re

from num2words import num2words
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.core.config import ROOT_DIR, WORKING_DAYS_PER_MONTH

# Brand palette
BRAND = colors.HexColor('#0020F8')
NAVY = colors.HexColor('#0B1E5B')
NAVY_DEEP = colors.HexColor('#071340')
GRAD_START = colors.HexColor('#0B1E5B')
GRAD_END = colors.HexColor('#4D6BFF')
SKY = colors.HexColor('#7DD3FC')
INK = colors.HexColor('#0F172A')
BODY = colors.HexColor('#334155')
MUTED = colors.HexColor('#64748B')
TINT = colors.HexColor('#F4F7FF')
TINT_STRONG = colors.HexColor('#E6EDFF')
ZEBRA = colors.HexColor('#F8FAFF')
RULE = colors.HexColor('#D6E0FF')
HAIRLINE = colors.HexColor('#E2E8F0')

COMPANY_NAME = "SPARKCURV TECHNOLOGIES PVT LIMITED"
COMPANY_ADDRESS = "64/3 Thompson Street, Palace Road, Nagercoil, Tamil Nadu 629001"

PAGE_W, PAGE_H = A4
MARGIN_X = 40
LOGO_STRIP_H = 80   # white strip carrying the logo
BAND_H = 54         # brand gradient band beneath it
HEADER_H = LOGO_STRIP_H + BAND_H


def _draw_page_chrome(canvas, period_label: str) -> None:
    """Header (white logo strip + gradient company band) and footer, drawn straight onto the canvas."""
    canvas.saveState()

    # --- White logo strip ---
    logo_path = os.path.join(ROOT_DIR, "uploads", "sparkcurv-logo-full.png")
    strip_bottom = PAGE_H - LOGO_STRIP_H
    logo_drawn = False
    if os.path.exists(logo_path):
        try:
            img = ImageReader(logo_path)
            iw, ih = img.getSize()
            logo_w = 150
            logo_h = logo_w * ih / iw
            canvas.drawImage(img, MARGIN_X, strip_bottom + (LOGO_STRIP_H - logo_h) / 2,
                             width=logo_w, height=logo_h, mask='auto')
            logo_drawn = True
        except Exception:
            pass
    if not logo_drawn:
        canvas.setFillColor(NAVY)
        canvas.setFont('Helvetica-Bold', 18)
        canvas.drawString(MARGIN_X, strip_bottom + LOGO_STRIP_H / 2 - 6, "SPARKCURV")

    right_x = PAGE_W - MARGIN_X
    canvas.setFillColor(BRAND)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawRightString(right_x, strip_bottom + 46, "P A Y S L I P")
    canvas.setFillColor(NAVY)
    canvas.setFont('Helvetica-Bold', 17)
    canvas.drawRightString(right_x, strip_bottom + 24, period_label)

    # --- Gradient company band (full bleed) ---
    band_bottom = strip_bottom - BAND_H
    canvas.saveState()
    path = canvas.beginPath()
    path.rect(0, band_bottom, PAGE_W, BAND_H)
    canvas.clipPath(path, stroke=0, fill=0)
    canvas.linearGradient(0, band_bottom, PAGE_W, band_bottom + BAND_H,
                          (NAVY_DEEP, GRAD_START, BRAND, GRAD_END), (0, 0.35, 0.7, 1), extend=True)
    canvas.restoreState()
    canvas.setFillColor(SKY)
    canvas.rect(0, band_bottom, PAGE_W, 2.5, stroke=0, fill=1)

    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 11)
    canvas.drawString(MARGIN_X, band_bottom + 31, COMPANY_NAME)
    canvas.setFillColor(colors.HexColor('#C7D7FF'))
    canvas.setFont('Helvetica', 8)
    canvas.drawString(MARGIN_X, band_bottom + 17, COMPANY_ADDRESS)
    canvas.setFillColor(SKY)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawRightString(right_x, band_bottom + 31, "SPARKCURV HR PORTAL")
    canvas.setFillColor(colors.HexColor('#C7D7FF'))
    canvas.setFont('Helvetica', 8)
    canvas.drawRightString(right_x, band_bottom + 17, "Private & Confidential")

    # --- Footer ---
    canvas.setStrokeColor(HAIRLINE)
    canvas.setLineWidth(0.75)
    canvas.line(MARGIN_X, 52, PAGE_W - MARGIN_X, 52)
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 7.5)
    canvas.drawCentredString(PAGE_W / 2, 38, "This is a computer-generated payslip from Sparkcurv HR Portal; "
                                            "therefore, a signature is not required.")
    canvas.setFillColor(BRAND)
    canvas.setFont('Helvetica-Bold', 7)
    canvas.drawCentredString(PAGE_W / 2, 26, f"{COMPANY_NAME}  •  PAYSLIP {period_label.upper()}")

    canvas.restoreState()


def generate_payslip_pdf(payslip: dict) -> io.BytesIO:
    buffer = io.BytesIO()
    period_label = f"{payslip['month_name']} {payslip['year']}"
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        # Frames add 6pt padding on every side; offset the margins so content aligns with the header at MARGIN_X.
        topMargin=HEADER_H + 20, bottomMargin=64, leftMargin=MARGIN_X - 6, rightMargin=MARGIN_X - 6,
        title=f"Payslip — {period_label}", author="Sparkcurv HR Portal",
    )
    elements = []
    page_width = PAGE_W - 2 * MARGIN_X

    section_style = ParagraphStyle('ST', fontSize=8, fontName='Helvetica-Bold', textColor=BRAND, leading=10)

    def section_title(text: str) -> Paragraph:
        return Paragraph(" ".join(text.upper()).replace("   ", " &nbsp; "), section_style)

    # ============ EMPLOYEE DETAILS ============
    label_s = ParagraphStyle('LS', fontSize=7.5, textColor=MUTED, leading=10)
    value_s = ParagraphStyle('VS', fontSize=9.5, textColor=INK, fontName='Helvetica-Bold', leading=12)

    # Calculate paid days and LOP days
    basic_salary = payslip.get('basic_salary', 0) or 0
    net_pay = payslip.get('net_pay', 0) or 0
    lop_days = 0
    for ded in payslip.get('deduction_details', []):
        desc = ded.get('description', '')
        if 'Loss of Pay' in desc:
            match = re.search(r'\((\d+)\s*days?\)', desc)
            if match:
                lop_days = int(match.group(1))
    paid_days = WORKING_DAYS_PER_MONTH - lop_days

    pay_month = payslip['month'] + 1
    pay_year = payslip['year']
    if pay_month > 12:
        pay_month = 1
        pay_year += 1
    pay_date = f"{5:02d}/{pay_month:02d}/{pay_year}"

    emp_code = payslip.get('employee_code', '') or str(payslip.get('employee_id', ''))

    def cell(label: str, value) -> list:
        return [Paragraph(label, label_s), Paragraph(str(value), value_s)]

    emp_rows = [
        [cell("Employee Name", payslip.get('employee_name', '')), cell("Pay Period", period_label)],
        [cell("Employee ID", emp_code), cell("Pay Date", pay_date)],
        [cell("Department", payslip.get('department', 'N/A')), cell("Paid Days", paid_days)],
        [cell("Designation", payslip.get('position', 'N/A')), cell("LOP Days", lop_days)],
    ]
    emp_table = Table(emp_rows, colWidths=[page_width * 0.58, page_width * 0.42])
    emp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), TINT),
        ('BOX', (0, 0), (-1, -1), 0.75, RULE),
        ('LINEBEFORE', (1, 0), (1, -1), 0.75, RULE),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, colors.white),
        ('ROUNDEDCORNERS', [8, 8, 8, 8]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 14),
        ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 12),
    ]))
    elements.append(section_title("Employee Details"))
    elements.append(Spacer(1, 8))
    elements.append(emp_table)
    elements.append(Spacer(1, 22))

    # ============ EARNINGS & DEDUCTIONS SIDE BY SIDE ============
    # Use pre-computed earnings if provided (from salary_components table), else fall back to hardcoded
    earnings_list = payslip.get("earnings_breakdown") or []
    if not earnings_list:
        basic = round(basic_salary * 0.50, 2)
        hra = round(basic_salary * 0.20, 2)
        medical = round(basic_salary * 0.045, 2)
        conveyance = round(basic_salary * 0.06, 2)
        special = round(basic_salary - basic - hra - medical - conveyance, 2)
        earnings_list = [
            {"name": "Basic", "amount": basic},
            {"name": "House Rent Allowance", "amount": hra},
            {"name": "Medical Allowance", "amount": medical},
            {"name": "Conveyance Allowance", "amount": conveyance},
            {"name": "Special Allowance", "amount": special},
        ]
    gross = basic_salary

    h_style = ParagraphStyle('HS', fontSize=8, fontName='Helvetica-Bold', textColor=colors.white, leading=10)
    h_r_style = ParagraphStyle('HRS', parent=h_style, alignment=2)
    r_style = ParagraphStyle('RS', fontSize=9, textColor=BODY, leading=12)
    r_r_style = ParagraphStyle('RRS', parent=r_style, textColor=INK, alignment=2)
    t_style = ParagraphStyle('TS', fontSize=9, fontName='Helvetica-Bold', textColor=NAVY, leading=12)
    t_r_style = ParagraphStyle('TRS', parent=t_style, alignment=2)

    gutter = 14
    half_w = (page_width - gutter) / 2

    def ledger_style(n_rows: int) -> TableStyle:
        cmds = [
            ('BACKGROUND', (0, 0), (-1, 0), BRAND),
            ('BACKGROUND', (0, -1), (-1, -1), TINT_STRONG),
            ('LINEABOVE', (0, -1), (-1, -1), 1, BRAND),
            ('BOX', (0, 0), (-1, -1), 0.75, RULE),
            ('ROUNDEDCORNERS', [8, 8, 8, 8]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 6.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6.5),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, -1), (-1, -1), 9),
            ('BOTTOMPADDING', (0, -1), (-1, -1), 9),
            ('LEFTPADDING', (0, 0), (-1, -1), 12),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ]
        for i in range(1, n_rows - 1):
            cmds.append(('BACKGROUND', (0, i), (-1, i), ZEBRA if i % 2 == 0 else colors.white))
        return TableStyle(cmds)

    # Earnings table
    earn_rows = [[Paragraph("EARNINGS", h_style), Paragraph("AMOUNT (Rs.)", h_r_style)]]
    for e in earnings_list:
        earn_rows.append([Paragraph(e["name"], r_style), Paragraph(f"{e['amount']:,.2f}", r_r_style)])

    # Deductions table
    total_deductions = payslip.get('total_deductions', 0) or 0
    deduction_details = payslip.get('deduction_details', [])

    ded_rows = [[Paragraph("DEDUCTIONS", h_style), Paragraph("AMOUNT (Rs.)", h_r_style)]]
    if deduction_details:
        for ded in deduction_details:
            ded_rows.append([
                Paragraph(ded.get('description', ''), r_style),
                Paragraph(f"{ded.get('amount', 0):,.2f}", r_r_style)
            ])
    else:
        ded_rows.append([Paragraph("No Deductions", r_style), Paragraph("0.00", r_r_style)])

    # Pad the shorter table so both totals line up
    while len(ded_rows) < len(earn_rows):
        ded_rows.append([Paragraph("&nbsp;", r_style), Paragraph("&nbsp;", r_r_style)])
    while len(earn_rows) < len(ded_rows):
        earn_rows.append([Paragraph("&nbsp;", r_style), Paragraph("&nbsp;", r_r_style)])

    earn_rows.append([Paragraph("Gross Earnings", t_style), Paragraph(f"{gross:,.2f}", t_r_style)])
    ded_rows.append([Paragraph("Total Deductions", t_style), Paragraph(f"{total_deductions:,.2f}", t_r_style)])

    e_table = Table(earn_rows, colWidths=[half_w * 0.64, half_w * 0.36])
    e_table.setStyle(ledger_style(len(earn_rows)))
    d_table = Table(ded_rows, colWidths=[half_w * 0.64, half_w * 0.36])
    d_table.setStyle(ledger_style(len(ded_rows)))

    combined = Table([[e_table, "", d_table]], colWidths=[half_w, gutter, half_w])
    combined.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(section_title("Salary Breakdown"))
    elements.append(Spacer(1, 8))
    elements.append(combined)
    elements.append(Spacer(1, 22))

    # ============ AMOUNT IN WORDS ============
    try:
        net_int = int(net_pay)
        paise = int(round((net_pay - net_int) * 100))
        words = num2words(net_int, lang='en_IN').replace(',', '').title()
        if paise > 0:
            paise_words = num2words(paise, lang='en_IN').title()
            amount_words = f"Indian Rupee {words} and {paise_words} Paise Only"
        else:
            amount_words = f"Indian Rupee {words} Only"
    except Exception:
        amount_words = ""

    # ============ NET PAY PANEL ============
    net_title_style = ParagraphStyle('NTS', fontSize=9, fontName='Helvetica-Bold', textColor=SKY, leading=11)
    net_formula_style = ParagraphStyle('NFS', fontSize=8, textColor=colors.HexColor('#C7D7FF'), leading=11)
    net_big_style = ParagraphStyle('NBS', fontSize=24, fontName='Helvetica-Bold', textColor=colors.white,
                                   alignment=2, leading=28)
    words_style = ParagraphStyle('WS', fontSize=8.5, textColor=colors.white, leading=12)

    net_left = [
        Paragraph("N E T &nbsp; P A Y", net_title_style),
        Spacer(1, 4),
        Paragraph("Gross Earnings - Total Deductions", net_formula_style),
    ]
    net_rows = [[net_left, Paragraph(f"Rs. {net_pay:,.2f}", net_big_style)]]
    if amount_words:
        net_rows.append([
            Paragraph(f'<font color="#7DD3FC"><b>Amount in words:</b></font>&nbsp; {amount_words}', words_style), ""
        ])
    net_box = Table(net_rows, colWidths=[page_width * 0.5, page_width * 0.5])
    net_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), BRAND),
        ('ROUNDEDCORNERS', [10, 10, 10, 10]),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, 0), 16),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 16),
        ('LEFTPADDING', (0, 0), (-1, -1), 18),
        ('RIGHTPADDING', (0, 0), (-1, -1), 18),
    ]
    if amount_words:
        net_cmds += [
            ('SPAN', (0, 1), (1, 1)),
            ('BACKGROUND', (0, 1), (-1, 1), GRAD_START),
            ('TOPPADDING', (0, 1), (-1, 1), 10),
            ('BOTTOMPADDING', (0, 1), (-1, 1), 10),
        ]
    net_box.setStyle(TableStyle(net_cmds))
    elements.append(net_box)

    doc.build(
        elements,
        onFirstPage=lambda c, d: _draw_page_chrome(c, period_label),
        onLaterPages=lambda c, d: _draw_page_chrome(c, period_label),
    )
    buffer.seek(0)
    return buffer
