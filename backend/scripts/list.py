#!/usr/bin/env python3
"""
file_sorter.py

This script lists all files and subfolders in a given directory and displays them
in a tabular form with the following columns:
    - Serial number
    - Name (prepended with relative path if depth > 1)
    - T (Type: F - file, D - directory, L - symlink)
    - Size (in bytes or human-readable)
    - Last modified date

Optional arguments allow sorting the output by name, size, or date in ascending or descending order.

Usage:
    python file_sorter.py [--sort_by <name|size|date>] [--order <asc|desc>] [--human] [--depth <n>] \
        [--name PATTERN] [--size MIN,MAX] [--mtime MIN_DAYS,MAX_DAYS] [--newer FILE] [<folder>]

Defaults:
    sort_by: None (no sorting)
    order: asc
    folder: Current working directory
    human: False
    depth: 1
"""

import argparse
from pathlib import Path
from datetime import datetime, timedelta
from tabulate import tabulate
import textwrap
import fnmatch
import yaml


def get_file_info(path: Path, root: Path, depth: int):
    stat = path.lstat()
    if path.is_symlink():
        ftype = "L"
    elif path.is_dir():
        ftype = "D"
    else:
        ftype = "F"

    rel_path = path.relative_to(root)
    parts = rel_path.parts

    if depth > 1 and len(parts) > 1:
        prefix = "/".join(parts[:-1])
        name = f"{prefix}/{parts[-1]}"
    else:
        name = parts[-1]

    return {
        "name": name,
        "type": ftype,
        "size": stat.st_size,
        "date": datetime.fromtimestamp(stat.st_mtime).astimezone(),
        "depth": len(parts),
        "path": path
    }


def human_readable_size(size_bytes):
    if size_bytes == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    i = 0
    while size_bytes >= 1024 and i < len(units) - 1:
        size_bytes /= 1024.0
        i += 1
    if i == 0:
        return f"{int(size_bytes)} {units[i]}"
    return f"{size_bytes:.1f} {units[i]}"


def wrap_and_indent(text, width=30, indent="- "):
    lines = textwrap.wrap(text, width=width)
    return [lines[0]] + [f"{indent}{line}" for line in lines[1:]]


def gather_files(root: Path, max_depth: int):
    results = []
    for path in root.rglob("*"):
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        depth = len(rel.parts)
        if depth <= max_depth:
            results.append(path)
    return results


def parse_size_range(size_range):
    if not size_range:
        return None, None
    parts = size_range.split(',')
    return int(parts[0]) if parts[0] else None, int(parts[1]) if len(parts) > 1 and parts[1] else None


def parse_mtime_range(mtime_range):
    if not mtime_range:
        return None, None
    parts = mtime_range.split(',')
    return int(parts[0]) if parts[0] else None, int(parts[1]) if len(parts) > 1 and parts[1] else None


def main():
    parser = argparse.ArgumentParser(description="List and optionally sort files in a folder")
    parser.add_argument("--sort_by", choices=["name", "size", "date"], default=None, help="Sort by field")
    parser.add_argument("--order", choices=["asc", "desc"], default="asc", help="Sorting order")
    parser.add_argument("--human", action="store_true", help="Display sizes in human-readable format")
    parser.add_argument("--depth", type=int, default=1, help="Max recursion depth (default 1)")
    parser.add_argument("--name", help="Filter by wildcard pattern (e.g. *.log)")
    parser.add_argument("--size", help="Filter by size range in bytes: min,max")
    parser.add_argument("--mtime", help="Filter by modified time range in days: min,max")
    parser.add_argument("--newer", help="Filter files newer than the specified file")
    parser.add_argument("folder", nargs="?", default=".", help="Target folder path (default: current directory)")

    args = parser.parse_args()

    folder_path = Path(args.folder).resolve()
    if not folder_path.exists() or not folder_path.is_dir():
        print(f"Error: '{folder_path}' is not a valid directory.")
        return

    if args.depth == 1:
        entries = list(folder_path.iterdir())
    else:
        entries = gather_files(folder_path, args.depth)

    files_info = [get_file_info(f, folder_path, args.depth) for f in entries]

    # Apply filters
    if args.name:
        files_info = [f for f in files_info if fnmatch.fnmatch(f["name"], args.name)]

    min_size, max_size = parse_size_range(args.size)
    if min_size is not None:
        files_info = [f for f in files_info if f["size"] >= min_size]
    if max_size is not None:
        files_info = [f for f in files_info if f["size"] <= max_size]

    min_days, max_days = parse_mtime_range(args.mtime)
    now = datetime.now().astimezone()
    if min_days is not None:
        min_time = now - timedelta(days=min_days)
        files_info = [f for f in files_info if f["date"] >= min_time]
    if max_days is not None:
        max_time = now - timedelta(days=max_days)
        files_info = [f for f in files_info if f["date"] <= max_time]

    if args.newer:
        newer_path = Path(args.newer)
        if newer_path.exists():
            threshold = datetime.fromtimestamp(newer_path.stat().st_mtime).astimezone()
            files_info = [f for f in files_info if f["date"] > threshold]

    if args.sort_by:
        reverse = args.order == "desc"
        files_info.sort(key=lambda x: x[args.sort_by], reverse=reverse)

    rows = []
    yaml_list = []
    for i, f in enumerate(files_info, start=1):
        name_lines = wrap_and_indent(f["name"])
        type_str = f["type"]
        size_str = (
            human_readable_size(f["size"])
            if args.human
            else str(int(f["size"]))
        )

        date_str = f["date"].strftime("%Y-%m-%d %H:%M:%S %Z")

        max_lines = len(name_lines)
        row = [
            [str(i)] + [""] * (max_lines - 1),
            name_lines,
            [type_str] + [""] * (max_lines - 1),
            [size_str] + [""] * (max_lines - 1),
            [date_str] + [""] * (max_lines - 1),
        ]
        rows.extend(zip(*row))

        yaml_list.append({
            "path": str(f["path"]),
            "name": f["name"],
            "type": type_str,
            "size": size_str,
            "date": date_str,
        })

    print(tabulate(
        rows,
        headers=["S.No", "Name", "T", "Size", "Modified Date"],
        tablefmt="github",
        stralign="left"
    ))

    print("\n--YAML--")
    yaml_output = {
        "directory": str(folder_path),
        "files": yaml_list
    }
    print(yaml.dump(yaml_output, sort_keys=False))


if __name__ == "__main__":
    main()
