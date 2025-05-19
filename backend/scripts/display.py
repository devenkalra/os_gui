import argparse
import json
import sys
import os
from backend.imviewer import start_image_viewer

def display_image(base_dir, rel_paths):
    try:
        start_image_viewer(base_dir, rel_paths)
    except Exception as e:
        print(f"Error displaying image: {e}")

def decode_reference(hex_str):
    try:
        json_str = bytes.fromhex(hex_str).decode("utf-8")
        return json.loads(json_str)
    except Exception as e:
        print(f"Error decoding --reference: {e}")
        sys.exit(1)
def parse_number_arg(number_arg):
    result = set()
    for part in number_arg.split(','):
        part = part.strip()
        if '-' in part:
            start, end = map(int, part.split('-'))
            result.update(range(start - 1, end))  # convert to 0-based
        else:
            result.add(int(part) - 1)
    return sorted(result)

def main():
    parser = argparse.ArgumentParser(description="Display an image from file or reference data.")
    parser.add_argument("-f", "--file", help="Path to image file (optional)")
    parser.add_argument("--reference", help="Hex-encoded JSON list of records (optional)")
    parser.add_argument("number", nargs="?", help="1-based index to select from reference")

    args = parser.parse_args()
    #print("Args:", args)
    if args.file:
        display_image(args.file)
    elif args.reference:
        if args.number is None:
            print("Error: --reference requires a positional number argument.")
            sys.exit(1)

        reference = decode_reference(args.reference)
        records = reference.get("files")
        folder = reference.get("directory")
        if folder is None or folder == "":
            folder = "."

        indexes = parse_number_arg(args.number)

        if not isinstance(records, list):
            print("Error: Decoded reference is not a list.")
            sys.exit(1)

        if len(indexes) ==0:
            print("Error: needs at least one index")
            sys.exit(1)

        to_display=[]
        for index in indexes:
            if index < 0 or index >= len(records):
                print(f"Error: Index {index + 1} out of range.")
                sys.exit(1)
            to_display.append(records[index])
 #       print("to_display", to_display)

        # Step 1: Extract full paths
        full_paths = [item["path"] for item in to_display]

        # Step 2: Find common root path
        common_root = os.path.commonpath(full_paths)
#        print(f"Common root: {common_root}")

        # Step 3: Update each dict with the relative path
        for item in to_display:
            item["name"] = os.path.relpath(item["path"], common_root)

        relative_paths = [x["name"] for x in to_display]

        if index < 0 or index >= len(records):
            print(f"Error: Index {args.number} out of range.")
            sys.exit(1)


        record = records[index]
        if "name" not in record:
            print(f"Error: Record at index {args.number} does not contain 'name' field.")
            sys.exit(1)

        display_image(common_root, relative_paths)
    else:
        print("Error: Either --file or --reference must be provided.")
        sys.exit(1)

if __name__ == "__main__":
    main()
