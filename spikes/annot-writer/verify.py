"""Second opinion on the spike's samples from tools that share no code with lopdf or PDFium:
qpdf (through pikepdf) checks the file structure, including the cross-reference chain and
encryption; pyHanko validates the signatures in the signed samples.

    <pyenv>/Scripts/python spikes/annot-writer/verify.py
"""

import pathlib

import pikepdf
from pyhanko.keys import load_cert_from_pemder
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

ROOT = pathlib.Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "bench-output" / "annot-spike" / "samples"
FIXTURES = ROOT / "bench-output" / "annot-spike" / "fixtures"
PASSWORDS = {"12-a3-aes256-password-vellum.pdf": "vellum"}


def qpdf_check(path):
    pw = PASSWORDS.get(path.name, "")
    with pikepdf.open(path, password=pw) as pdf:
        problems = [str(p) for p in pdf.check_pdf_syntax()] + [str(w) for w in pdf.get_warnings()]
        ours = []
        for a in pdf.pages[0].get("/Annots", []) or []:
            if not isinstance(a, pikepdf.Dictionary):
                continue
            nm = str(a.get("/NM", ""))
            if nm.startswith("vellum-"):
                ours.append((str(a.get("/Subtype")), str(a.get("/Contents", ""))))
        return problems, ours, pdf.is_encrypted


def signature(path, trust):
    with open(path, "rb") as f:
        r = PdfFileReader(f)
        out = []
        for sig in r.embedded_signatures:
            st = validate_pdf_signature(sig, ValidationContext(trust_roots=[trust]))
            out.append(f"intact={st.intact} valid={st.valid} coverage={st.coverage.name} "
                       f"modifications={st.modification_level.name if st.modification_level else None} "
                       f"docmdp_ok={st.docmdp_ok}")
        return out


def main():
    trust = load_cert_from_pemder(str(FIXTURES / "signer-cert.pem"))
    bad = 0
    for path in sorted(SAMPLES.glob("*.pdf")):
        try:
            problems, ours, enc = qpdf_check(path)
        except Exception as e:  # qpdf could not open it at all
            problems, ours, enc = [f"qpdf could not open it: {e}"], [], False
        measures = [c for s, c in ours if c and s in ("/Line", "/Polygon") and c[0].isdigit()]
        status = "ok" if not problems else "PROBLEMS"
        print(f"{path.name:<44} qpdf {status}; {len(ours)} of ours on p1"
              f"{' (encrypted)' if enc else ''}; measurements read back: {', '.join(measures) or '-'}")
        for p in problems:
            print(f"    - {p}")
        bad += bool(problems)
        if "signed" in path.name or "certified" in path.name:
            orig = FIXTURES / {"14": "a4-signed.pdf", "15": "a4-certified-annots.pdf",
                               "16": "a4-certified-noannots.pdf"}[path.name[:2]]
            for line in signature(orig, trust)[:1]:
                print(f"    signature before: {line}")
            for line in signature(path, trust):
                print(f"    signature after:  {line}")
    if bad:
        raise SystemExit(f"{bad} file(s) with problems")


if __name__ == "__main__":
    main()
