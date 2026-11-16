"""Phase 0 spike fixtures: variants of the synthetic PDFs that the annotation writer must cope with.

Writes to bench-output/annot-spike/fixtures/ (git-ignored). Run after `npm run gen:synthetic`:

    python -m venv <somewhere>/pyenv
    <somewhere>/pyenv/Scripts/python -m pip install pikepdf pyhanko
    <somewhere>/pyenv/Scripts/python spikes/annot-writer/fixtures.py

pikepdf (qpdf) makes the object-stream and encrypted variants; pyHanko makes the signed ones
with a throwaway self-signed certificate. Neither is a Vellum dependency: they only make test
files, and `verify.py` uses them as an independent second opinion on the writer's output.
"""

import datetime
import pathlib
import shutil

import pikepdf
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pyhanko.sign import fields, signers
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

ROOT = pathlib.Path(__file__).resolve().parents[2]
SYN = ROOT / "bench-output" / "synthetic"
OUT = ROOT / "bench-output" / "annot-spike" / "fixtures"

A1 = SYN / "1-a1-200k-lines.pdf"
A3SET = SYN / "3-a3-40-pages.pdf"
A4DOC = SYN / "5-a4-300-pages.pdf"


def log(msg):
    print(f"fixtures: {msg}")


def objstm(src, dst):
    """Rewrite with object streams and a cross-reference stream (what Acrobat and most CAD
    exporters since PDF 1.5 produce): page dictionaries end up inside object streams."""
    with pikepdf.open(src) as pdf:
        pdf.save(dst, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    log(f"{dst.name}: object streams + xref stream")


def encrypted(src, dst, *, R, aes, user="", objstreams=False, allow=None):
    with pikepdf.open(src) as pdf:
        enc = pikepdf.Encryption(owner="owner-secret", user=user, R=R, aes=aes, metadata=R >= 4,
                                 allow=allow or pikepdf.Permissions())
        mode = pikepdf.ObjectStreamMode.generate if objstreams else pikepdf.ObjectStreamMode.disable
        pdf.save(dst, encryption=enc, object_stream_mode=mode)
    log(f"{dst.name}: R{R} {'AES' if aes else 'RC4'} user={user!r} objstm={objstreams}")


def with_existing_annotations(src, dst, *, objstreams):
    """Page 1 gets annotations as another app might write them, including the awkward cases
    for matching PDFium's annotation index to the object: a Popup (PDFium counts it), a null
    entry, and /Annots as an indirect array."""
    with pikepdf.open(src) as pdf:
        page = pdf.pages[0]

        def ap(bbox, content):
            s = pikepdf.Stream(pdf, content.encode("latin-1"))
            s.Type = pikepdf.Name.XObject
            s.Subtype = pikepdf.Name.Form
            s.BBox = pikepdf.Array(bbox)
            return pdf.make_indirect(s)

        square = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Square,
            Rect=[200, 1300, 500, 1500], C=[0, 0, 1], BS=pikepdf.Dictionary(W=4),
            NM=pikepdf.String("existing-square"), T=pikepdf.String("Other app"),
            Contents=pikepdf.String("Existing square"), F=4,
            AP=pikepdf.Dictionary(N=ap([200, 1300, 500, 1500], "0 0 1 RG 4 w 202 1302 296 196 re S")),
        ))
        line = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Line,
            Rect=[600, 1290, 1000, 1510], L=[610, 1300, 990, 1500],
            LE=[pikepdf.Name("/None"),
                pikepdf.Name.OpenArrow],
            C=[0, 0.6, 0], BS=pikepdf.Dictionary(W=3), NM=pikepdf.String("existing-line"),
            Contents=pikepdf.String("Existing line"), F=4,
            AP=pikepdf.Dictionary(N=ap([600, 1290, 1000, 1510], "0 0.6 0 RG 3 w 610 1300 m 990 1500 l S")),
        ))
        note = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Text,
            Rect=[1100, 1450, 1124, 1474], C=[1, 0.8, 0], NM=pikepdf.String("existing-note"),
            Contents=pikepdf.String("Existing sticky note"), F=4, Name=pikepdf.Name.Comment,
        ))
        popup = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Popup,
            Rect=[1130, 1350, 1330, 1470], Parent=note, Open=False,
        ))
        note.Popup = popup
        freetext = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.FreeText,
            Rect=[200, 1100, 600, 1160], DA=pikepdf.String("0 0 0 rg /Helv 18 Tf"),
            Contents=pikepdf.String("Existing text box"), NM=pikepdf.String("existing-freetext"), F=4,
            AP=pikepdf.Dictionary(N=ap([200, 1100, 600, 1160],
                                       "BT /Helv 18 Tf 0 0 0 rg 205 1122 Td (Existing text box) Tj ET")),
        ))
        freetext.AP.N.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(Helv=pikepdf.Dictionary(
            Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica,
            Encoding=pikepdf.Name.WinAnsiEncoding)))
        for a in (square, line, note, popup, freetext):
            a.P = page.obj
        # Order chosen so the null and the Popup sit between real annotations.
        annots = pikepdf.Array([square, None, line, note, popup, freetext])
        page.obj.Annots = pdf.make_indirect(annots)
        mode = pikepdf.ObjectStreamMode.generate if objstreams else pikepdf.ObjectStreamMode.disable
        pdf.save(dst, object_stream_mode=mode)
    log(f"{dst.name}: 5 annotations + a null in an indirect /Annots, objstm={objstreams}")


def rotated(src, dst):
    with pikepdf.open(src) as pdf:
        pdf.pages[0].obj.Rotate = 90
        pdf.save(dst)
    log(f"{dst.name}: page 1 /Rotate 90")


def broken_xref(src, dst):
    """A tolerated-but-malformed file: every offset in the xref table is shifted by 7 bytes,
    which PDFium and lopdf both recover from by scanning. CAD exporters produce similar."""
    data = bytearray(src.read_bytes())
    start = data.rfind(b"startxref")
    xref_at = int(data[start + 9:].split()[0])
    table_end = data.index(b"trailer", xref_at)
    lines = data[xref_at:table_end].split(b"\n")
    out = []
    for ln in lines:
        parts = ln.split()
        if len(parts) == 3 and parts[2] in (b"n", b"f") and len(parts[0]) == 10 and parts[2] == b"n":
            out.append(b"%010d %s n " % (int(parts[0]) + 7, parts[1]))
        else:
            out.append(ln)
    data[xref_at:table_end] = b"\n".join(out)
    dst.write_bytes(bytes(data))
    log(f"{dst.name}: xref offsets all wrong by 7 bytes")


def make_signer(folder):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Vellum spike test signer")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=True,
                                         key_encipherment=False, data_encipherment=False,
                                         key_agreement=False, key_cert_sign=True, crl_sign=False,
                                         encipher_only=False, decipher_only=False), critical=True)
            .sign(key, hashes.SHA256()))
    (folder / "signer-key.pem").write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (folder / "signer-cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return signers.SimpleSigner.load(str(folder / "signer-key.pem"), str(folder / "signer-cert.pem"))


def signed(src, dst, signer, *, certify, perm=None):
    meta = signers.PdfSignatureMetadata(field_name="Signature1", certify=certify,
                                        docmdp_permissions=perm or fields.MDPPerm.FILL_FORMS)
    with open(src, "rb") as inf, open(dst, "wb") as outf:
        w = IncrementalPdfFileWriter(inf)
        signers.sign_pdf(w, meta, signer=signer, output=outf,
                         new_field_spec=fields.SigFieldSpec("Signature1", box=(60, 60, 260, 110)))
    log(f"{dst.name}: {'certified ' + perm.name if certify else 'approval signature'}")


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    for f in (A1, A3SET, A4DOC):
        if not f.exists():
            raise SystemExit(f"missing {f}: run `npm run gen:synthetic` first")

    objstm(A1, OUT / "a1-objstm.pdf")
    encrypted(A3SET, OUT / "a3-rc4-40.pdf", R=2, aes=False)
    encrypted(A3SET, OUT / "a3-rc4-128.pdf", R=3, aes=False)
    encrypted(A3SET, OUT / "a3-aes128.pdf", R=4, aes=True)
    encrypted(A3SET, OUT / "a3-aes256.pdf", R=6, aes=True)
    encrypted(A3SET, OUT / "a3-aes256-objstm.pdf", R=6, aes=True, objstreams=True)
    encrypted(A3SET, OUT / "a3-aes256-userpw.pdf", R=6, aes=True, user="vellum")
    encrypted(A3SET, OUT / "a3-aes256-noannot.pdf", R=6, aes=True,
              allow=pikepdf.Permissions(modify_annotation=False, modify_other=False))
    with_existing_annotations(A1, OUT / "a1-existing-annots.pdf", objstreams=False)
    with_existing_annotations(A1, OUT / "a1-existing-annots-objstm.pdf", objstreams=True)
    rotated(A1, OUT / "a1-rotated.pdf")
    broken_xref(A4DOC, OUT / "a4-broken-xref.pdf")

    signer = make_signer(OUT)
    signed(A4DOC, OUT / "a4-signed.pdf", signer, certify=False)
    signed(A4DOC, OUT / "a4-certified-noannots.pdf", signer, certify=True, perm=fields.MDPPerm.FILL_FORMS)
    signed(A4DOC, OUT / "a4-certified-annots.pdf", signer, certify=True, perm=fields.MDPPerm.ANNOTATE)


if __name__ == "__main__":
    main()
