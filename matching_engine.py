"""
Bootstrap matching engine data prep.
- Reads ILIDataV2.xlsx (default path: ./ILIDataV2.xlsx or override via CLI arg)
- Lists sheet names and confirms 2015 & 2022 present.
- Builds canonical anomaly tables with consistent fields.
- Cleans: drop missing pos_ft, coerce numerics, normalize ID/OD, convert hh:mm clock.
- Writes out/canonical_2015.csv and out/canonical_2022.csv.
- Prints a data dictionary mapping canonical fields to raw columns.
"""

from __future__ import annotations

import csv
import sys
import xml.etree.ElementTree as ET
from collections import OrderedDict
from dataclasses import dataclass
from typing import List, Optional, Dict
from zipfile import ZipFile

XLSX_PATH = sys.argv[1] if len(sys.argv) > 1 else "ILIDataV2.xlsx"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# -------- minimal xlsx reader (no external deps) ----------
def read_shared_strings(z: ZipFile) -> List[str]:
    try:
        data = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    return ["".join(si.itertext()) for si in root.findall(f"{NS}si")]


def col_to_index(col: str) -> int:
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx


def sheet_paths(z: ZipFile) -> OrderedDict:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(
            "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
        )
    }
    sheets = OrderedDict()
    for sh in wb.findall(f"{NS}sheets/{NS}sheet"):
        name = sh.attrib["name"]
        rid = sh.attrib[
            "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
        ]
        target = rel_map[rid]
        if not target.startswith("xl/"):
            target = "xl/" + target
        sheets[name] = target
    return sheets


def read_sheet(z: ZipFile, sheet_path: str, shared_strings: List[str]) -> List[List[str]]:
    root = ET.fromstring(z.read(sheet_path))
    rows = []
    max_col = 0
    for row in root.findall(f".//{NS}sheetData/{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            ref = c.attrib.get("r", "")
            col_letters = "".join(ch for ch in ref if ch.isalpha()) or "A"
            col_idx = col_to_index(col_letters)
            max_col = max(max_col, col_idx)
            t = c.attrib.get("t")
            v = c.find(f"{NS}v")
            text = ""
            if t == "inlineStr":
                is_elem = c.find(f"{NS}is")
                if is_elem is not None:
                    text = "".join(is_elem.itertext())
            elif v is not None and v.text is not None:
                text = v.text
                if t == "s":
                    try:
                        text = shared_strings[int(text)]
                    except Exception:
                        pass
                elif t == "b":
                    text = "TRUE" if text == "1" else "FALSE"
            cells[col_idx] = text
        rows.append(cells)
    data = []
    for r in rows:
        data.append([r.get(i, "") for i in range(1, max_col + 1)])
    return data


# -------- helpers ----------
def to_float(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        if ":" in s:
            parts = s.split(":")
            try:
                h = float(parts[0])
                m = float(parts[1]) if len(parts) > 1 else 0
                return h + m / 60.0
            except Exception:
                return None
        return None


def normalize_side(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip().upper()
    if s in ("ID", "OD"):
        return s
    return s if s else None


@dataclass
class Anomaly:
    row_id: int
    year: str
    pos_ft: float
    clock_hr: Optional[float]
    side: Optional[str]
    depth_pct: Optional[float]
    len_in: Optional[float]
    wid_in: Optional[float]
    type: Optional[str]
    dist_to_seam_in: Optional[float]
    seam_clock_hr: Optional[float]


YEAR_CONFIG = {
    "2015": {
        "pos": "Log Dist. [ft]",
        "clock": "O'clock",
        "side": "ID/OD",
        "depth": ["Depth [%]", "OD Reduction [%]"],
        "len": "Length [in]",
        "wid": "Width [in]",
        "type": "Event Description",
        "dist_to_seam": None,  # not available
        "seam_clock": "Seam Position (TFI)",
    },
    "2022": {
        "pos": "ILI Wheel Count \n[ft.]",
        "clock": "O'clock\n[hh:mm]",
        "side": "ID/OD",
        "depth": ["Metal Loss Depth \n[%]", "Dent Depth\n [%]", "Metal Loss Depth + Tolerance\n[%]"],
        "len": "Length [in]",
        "wid": "Width [in]",
        "type": "Event Description",
        "dist_to_seam": "Distance To Seam Weld \n[in]",
        "seam_clock": "Seam Position\n[hh:mm]",
    },
}


def load_year(sheet: str, path: str) -> List[Anomaly]:
    cfg = YEAR_CONFIG[sheet]
    with ZipFile(path) as z:
        shared = read_shared_strings(z)
        sheets = sheet_paths(z)
        if sheet not in sheets:
            raise ValueError(f"Sheet {sheet} not found")
        data = read_sheet(z, sheets[sheet], shared)
    headers = data[0]
    rows = data[1:]
    idx = {h: i for i, h in enumerate(headers)}
    out: List[Anomaly] = []
    for row in rows:
        pos = to_float(row[idx[cfg["pos"]]]) if cfg["pos"] in idx else None
        if pos is None:
            continue
        depth_val = None
        for dcol in cfg["depth"]:
            if dcol in idx:
                depth_val = to_float(row[idx[dcol]])
                if depth_val is not None:
                    break
        anomaly = Anomaly(
            row_id=len(out),
            year=sheet,
            pos_ft=pos,
            clock_hr=to_float(row[idx[cfg["clock"]]]) if cfg["clock"] in idx else None,
            side=normalize_side(row[idx[cfg["side"]]]) if cfg["side"] in idx else None,
            depth_pct=depth_val,
            len_in=to_float(row[idx[cfg["len"]]]) if cfg["len"] in idx else None,
            wid_in=to_float(row[idx[cfg["wid"]]]) if cfg["wid"] in idx else None,
            type=row[idx[cfg["type"]]] if cfg["type"] in idx else None,
            dist_to_seam_in=to_float(row[idx[cfg["dist_to_seam"]]]) if cfg["dist_to_seam"] and cfg["dist_to_seam"] in idx else None,
            seam_clock_hr=to_float(row[idx[cfg["seam_clock"]]]) if cfg["seam_clock"] in idx else None,
        )
        out.append(anomaly)
    return out


def write_csv(path: str, rows: List[Anomaly]):
    fieldnames = [
        "row_id",
        "year",
        "pos_ft",
        "clock_hr",
        "side",
        "depth_pct",
        "len_in",
        "wid_in",
        "type",
        "dist_to_seam_in",
        "seam_clock_hr",
    ]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r.__dict__)


def main():
    print(f"Reading workbook: {XLSX_PATH}")
    with ZipFile(XLSX_PATH) as z:
        sheets = list(sheet_paths(z).keys())
    print("Sheets found:", sheets)
    for required in ("2015", "2022"):
        if required not in sheets:
            raise SystemExit(f"Missing required sheet {required}")

    rows2015 = load_year("2015", XLSX_PATH)
    rows2022 = load_year("2022", XLSX_PATH)
    write_csv("out/canonical_2015.csv", rows2015)
    write_csv("out/canonical_2022.csv", rows2022)
    print(f"Wrote out/canonical_2015.csv rows={len(rows2015)}")
    print(f"Wrote out/canonical_2022.csv rows={len(rows2022)}")

    data_dict: Dict[str, str] = {
        "row_id": "Sequential row index after cleaning (0-based).",
        "year": "Sheet/year label (2015 or 2022).",
        "pos_ft": "Linear distance along pipe in feet; rows missing this are dropped. Raw columns: 2015 'Log Dist. [ft]', 2022 'ILI Wheel Count [ft.]'.",
        "clock_hr": "Clock position in decimal hours (0–12). Raw: 2015 'O'clock'; 2022 'O'clock [hh:mm]' converted from hh:mm.",
        "side": "ID/OD indicator, uppercased. Raw: 'ID/OD'.",
        "depth_pct": "Primary depth percentage (metal loss/dent). Raw: 2015 Depth [%]/OD Reduction [%]; 2022 Metal Loss Depth [%]/Dent Depth [%]/Metal Loss Depth + Tolerance [%].",
        "len_in": "Anomaly length in inches. Raw: 'Length [in]'.",
        "wid_in": "Anomaly width in inches. Raw: 'Width [in]'.",
        "type": "Event/anomaly description. Raw: 'Event Description'.",
        "dist_to_seam_in": "Distance to seam weld (inches) when present. Raw: 2022 'Distance To Seam Weld [in]'; not available in 2015.",
        "seam_clock_hr": "Seam position clock (decimal hours). Raw: 2015 'Seam Position (TFI)'; 2022 'Seam Position [hh:mm]'.",
    }
    print("\nData dictionary:")
    for k, v in data_dict.items():
        print(f"- {k}: {v}")


if __name__ == "__main__":
    main()
