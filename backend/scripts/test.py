import argparse
import sys
from PIL import Image

def display_image(path):
    try:
        img = Image.open(path)
        img.show()
    except Exception as e:
        print(f"Error displaying image: {e}")

def main():
    parser = argparse.ArgumentParser(description="Display an image from file or record.")
    parser.add_argument("-f", "--file", help="Path to image file")
    parser.add_argument("number", type=int, nargs="?", help="Index number of the record (1-based)")

    args = parser.parse_args()

    if not args.file and args.number is None:
        print("Error: You must specify either --file or number.")
        sys.exit(1)

    if args.file:
        print (f"Displaying image from file: {args.file}")
        display_image(args.file)
    else:
        if "records" not in globals():
            print("Error: 'records' variable not defined in global scope.")
            sys.exit(1)

        index = args.number - 1
        if index < 0 or index >= len(records):
            print(f"Error: Index {args.number} out of range.")
            sys.exit(1)

        record = records[index]
        if "name" not in record:
            print(f"Error: Record at index {args.number} does not contain 'name' field.")
            sys.exit(1)

        print(f"Displaying image from record: {record['name']}")
        display_image(record["name"])

if __name__ == "__main__":
    main()
