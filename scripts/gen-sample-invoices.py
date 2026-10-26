#!/usr/bin/env python3
"""Generate sample invoice PDFs for testing the AI Document Extraction Platform."""
import os
from fpdf import FPDF

OUT_DIR = "/home/z/my-project/upload/sample-invoices"
os.makedirs(OUT_DIR, exist_ok=True)

def make_invoice(filename, *, vendor, invoice_no, invoice_date, due_date, bill_to,
                 items, subtotal, tax, total, currency="USD", email=None):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 22)
    pdf.cell(0, 12, "INVOICE", ln=1)
    pdf.set_font("Helvetica", "", 10)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 6, vendor, ln=1)
    pdf.set_font("Helvetica", "", 9)
    if email:
        pdf.cell(0, 5, f"Email: {email}", ln=1)
    pdf.ln(6)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(40, 6, "Invoice Number:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, invoice_no, ln=1)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(40, 6, "Invoice Date:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, invoice_date, ln=1)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(40, 6, "Due Date:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, due_date, ln=1)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(40, 6, "Bill To:")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, bill_to, ln=1)
    pdf.ln(8)

    # Line items table
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(80, 7, "Description", border=1)
    pdf.cell(20, 7, "Qty", border=1, align="C")
    pdf.cell(40, 7, "Unit Price", border=1, align="R")
    pdf.cell(40, 7, "Line Total", border=1, align="R", ln=1)

    pdf.set_font("Helvetica", "", 10)
    for desc, qty, unit, line in items:
        pdf.cell(80, 7, desc, border=1)
        pdf.cell(20, 7, str(qty), border=1, align="C")
        pdf.cell(40, 7, f"{currency} {unit:.2f}", border=1, align="R")
        pdf.cell(40, 7, f"{currency} {line:.2f}", border=1, align="R", ln=1)
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 10)
    pdf.cell(140, 6, "", border=0)
    pdf.cell(40, 6, "Subtotal:", border=0, align="R")
    pdf.cell(0, 6, f"{currency} {subtotal:.2f}", ln=1, align="R")

    pdf.cell(140, 6, "", border=0)
    pdf.cell(40, 6, "Tax (8%):", border=0, align="R")
    pdf.cell(0, 6, f"{currency} {tax:.2f}", ln=1, align="R")

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(140, 8, "", border=0)
    pdf.cell(40, 8, "TOTAL:", border=0, align="R")
    pdf.cell(0, 8, f"{currency} {total:.2f}", ln=1, align="R")

    out_path = os.path.join(OUT_DIR, filename)
    pdf.output(out_path)
    print(f"  ✓ {out_path}")
    return out_path

print("Generating sample invoices:")

make_invoice(
    "sample-invoice-1-acme.pdf",
    vendor="Acme Corporation",
    email="billing@acme-corp.com",
    invoice_no="ACM-2026-0042",
    invoice_date="2026-10-25",
    due_date="2026-11-25",
    bill_to="Globex Industries Inc.",
    items=[
        ("Monthly consulting retainer", 1, 1250.00, 1250.00),
        ("Additional development hours", 8, 95.00, 760.00),
        ("Cloud hosting reimbursement", 1, 240.00, 240.00),
    ],
    subtotal=2250.00,
    tax=180.00,
    total=2430.00,
)

make_invoice(
    "sample-invoice-2-techsupplies.pdf",
    vendor="TechSupplies LLC",
    email="accounts@techsupplies.example.com",
    invoice_no="TS-INV-9981",
    invoice_date="2026-10-20",
    due_date="2026-12-04",
    bill_to="Stark Enterprises",
    items=[
        ("Mechanical keyboard (RGB)", 5, 89.99, 449.95),
        ("27-inch 4K monitor", 2, 399.00, 798.00),
        ("USB-C dock", 3, 159.50, 478.50),
    ],
    subtotal=1726.45,
    tax=138.12,
    total=1864.57,
)

make_invoice(
    "sample-invoice-3-zenithservices.pdf",
    vendor="Zenith Marketing Services",
    email="hello@zenithmarketing.co",
    invoice_no="ZMS-2026-Q4-017",
    invoice_date="2026-10-15",
    due_date="2026-11-15",
    bill_to="Initech LLC",
    items=[
        ("SEO audit and report", 1, 800.00, 800.00),
        ("Social media campaign - November 2026", 1, 1500.00, 1500.00),
    ],
    subtotal=2300.00,
    tax=184.00,
    total=2484.00,
)

print(f"\nGenerated 3 sample invoices in {OUT_DIR}")
