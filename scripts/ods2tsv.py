#!/usr/bin/env python3
"""OpenDocument 試算表(.ods)→ TSV(供人讀與 diff;只用標準函式庫)。

用法:python3 -I scripts/ods2tsv.py x.ods > x.tsv
每個工作表前一行「#### SHEET <名稱>」;儲存格內換行改成「 / 」;Tab 改成空白;列尾空格不輸出。
"""
import sys
import zipfile
import xml.etree.ElementTree as ET

T = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
P = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}p'


def cell_text(c):
    return ' / '.join(''.join(p.itertext()).strip() for p in c.iter(P)).replace('\t', ' ').strip()


def main(path):
    root = ET.fromstring(zipfile.ZipFile(path).read('content.xml'))
    out = []
    for tbl in root.iter(T + 'table'):
        out.append(f"#### SHEET {tbl.get(T + 'name')}")
        for row in tbl.iter(T + 'table-row'):
            cells = []
            for c in row:
                if c.tag not in (T + 'table-cell', T + 'covered-table-cell'):
                    continue
                n = int(c.get(T + 'number-columns-repeated', '1'))
                cells += [cell_text(c)] * min(n, 64)   # 整列空白重複上千格時截斷
            while cells and cells[-1] == '':
                cells.pop()
            if cells:
                out.append('\t'.join(cells))
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main(sys.argv[1])
