"""
Reads spec.yaml (OpenAPI 3.x) and generates a compact markdown reference
with method summaries and line-number pointers back to the full spec.
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML not found. Install it with: pip install pyyaml")
    sys.exit(1)

SPEC_FILE = Path(__file__).parent / "spec.yaml"
OUT_FILE = Path(__file__).parent / "spec_summary.md"

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def load_raw_lines(path: Path) -> list[str]:
    with open(path, encoding="utf-8") as f:
        return f.readlines()


def build_line_index(lines: list[str]) -> dict[tuple[str, str], int]:
    """
    Returns {(path, method): 1-based line number} for every path+method pair
    found in the paths: section of an OpenAPI YAML file.
    """
    index: dict[tuple[str, str], int] = {}
    in_paths = False
    current_path: str | None = None

    for lineno, raw in enumerate(lines, start=1):
        stripped = raw.strip()

        # Detect start of paths block (top-level key)
        if re.match(r"^paths\s*:", raw):
            in_paths = True
            continue

        if not in_paths:
            continue

        # A new top-level key ends the paths block
        if re.match(r"^\S", raw) and not raw.startswith(" "):
            in_paths = False
            continue

        # Path entry: indented exactly 4 spaces (YAML indent = 4 in this file)
        m = re.match(r"^    (/[^\s:]+)\s*:", raw)
        if m:
            current_path = m.group(1)
            continue

        # HTTP method under a path: indented 8 spaces
        if current_path:
            m2 = re.match(r"^        (" + "|".join(HTTP_METHODS) + r")\s*:", raw)
            if m2:
                method = m2.group(1).upper()
                index[(current_path, method)] = lineno

    return index


def parse_spec(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def first_sentence(text: str | None) -> str:
    if not text:
        return ""
    # Collapse whitespace / newlines then take up to the first sentence break
    text = re.sub(r"\s+", " ", text).strip()
    m = re.match(r"([^.!?\n]{1,300}[.!?])", text)
    return m.group(1).strip() if m else text[:300].strip()


def generate_summary(spec: dict, line_index: dict[tuple[str, str], int]) -> str:
    lines: list[str] = []
    info = spec.get("info", {})
    lines.append(f"# {info.get('title', 'API')} — Method Reference\n")
    lines.append(
        f"Auto-generated from `spec.yaml`. Line numbers point to the full spec.\n\n"
    )
    lines.append(f"Base URL: `{spec.get('servers', [{}])[0].get('url', '')}`\n\n")

    paths: dict = spec.get("paths", {})

    # Group by tag for readability
    tag_groups: dict[str, list[tuple[str, str, dict]]] = {}
    for path, path_obj in paths.items():
        for method, op in path_obj.items():
            if method not in HTTP_METHODS:
                continue
            tags = op.get("tags") or ["(untagged)"]
            for tag in tags:
                tag_groups.setdefault(tag, []).append((path, method.upper(), op))

    for tag in sorted(tag_groups.keys()):
        lines.append(f"\n## {tag}\n\n")
        lines.append("| Method | Path | Summary | Line |\n")
        lines.append("|--------|------|---------|------|\n")
        for path, method, op in sorted(tag_groups[tag], key=lambda x: x[0]):
            summary = op.get("summary") or first_sentence(op.get("description"))
            lineno = line_index.get((path, method))
            line_ref = f"[:{lineno}](spec.yaml#L{lineno})" if lineno else "—"
            # Escape pipes in summary
            summary_safe = (summary or "").replace("|", "\\|")
            lines.append(f"| `{method}` | `{path}` | {summary_safe} | {line_ref} |\n")

    lines.append("\n---\n")
    lines.append("## Detailed Descriptions\n\n")
    for path, path_obj in paths.items():
        for method, op in path_obj.items():
            if method not in HTTP_METHODS:
                continue
            lineno = line_index.get((path, method.upper()))
            line_ref = f" ([spec.yaml:{lineno}](spec.yaml#L{lineno}))" if lineno else ""
            op_id = op.get("operationId", "")
            lines.append(f"### `{method.upper()} {path}`{line_ref}\n\n")
            if op_id:
                lines.append(f"**operationId:** `{op_id}`  \n")
            tags = op.get("tags") or []
            if tags:
                lines.append(f"**tags:** {', '.join(tags)}  \n")
            desc = op.get("description") or op.get("summary") or ""
            desc_clean = re.sub(r"\s+", " ", desc).strip()
            if desc_clean:
                lines.append(f"\n{desc_clean}\n")
            lines.append("\n")

    return "".join(lines)


def main():
    print(f"Reading {SPEC_FILE} …")
    raw_lines = load_raw_lines(SPEC_FILE)
    print(f"  {len(raw_lines)} lines total")

    print("Indexing line numbers …")
    line_index = build_line_index(raw_lines)
    print(f"  {len(line_index)} path+method entries found")

    print("Parsing YAML …")
    spec = parse_spec(SPEC_FILE)

    print("Generating summary …")
    summary = generate_summary(spec, line_index)

    OUT_FILE.write_text(summary, encoding="utf-8")
    print(f"Summary written to {OUT_FILE}")
    print(f"  {len(summary.splitlines())} lines")


if __name__ == "__main__":
    main()
