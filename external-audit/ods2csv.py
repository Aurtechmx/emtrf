"""ODS -> CSV without third-party packages (reads content.xml; expands repeated cells)."""
import sys, zipfile, re, csv
def rows(path):
    x = zipfile.ZipFile(path).read("content.xml").decode("utf8")
    for tm in re.finditer(r"<table:table-row[^>]*?(?:/>|>(.*?)</table:table-row>)", x, re.S):
        body = tm.group(1) or ""
        out = []
        for cm in re.finditer(r"<table:table-cell([^>]*?)(?:/>|>(.*?)</table:table-cell>)", body, re.S):
            a = cm.group(1); rep = re.search(r'number-columns-repeated="(\d+)"', a); n = int(rep.group(1)) if rep else 1
            v = re.search(r'office:value="([^"]*)"', a)
            val = v.group(1) if v else re.sub(r"<[^>]+>", "", cm.group(2) or "")
            if n > 50 and not val: continue
            out += [val] * n
        while out and out[-1] == "": out.pop()
        if out: yield out
if __name__ == "__main__":
    w = csv.writer(open(sys.argv[2], "w", newline=""))
    for r in rows(sys.argv[1]): w.writerow(r)
