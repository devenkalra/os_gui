import argparse
import json
import sys
import os
from flask import Flask, send_from_directory, render_template_string, request, jsonify
from threading import Thread
import webview
from PIL import Image, ExifTags
import socket

app = Flask(__name__)

base_dir = ""
rel_paths = []
index = 0
show_exif = False

HTML_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Image Viewer</title>
    <style>
        body { margin: 0; background: #000; color: white; font-family: sans-serif; }
        #container { text-align: center; }
        img { max-width: 100vw; max-height: 100vh; }
        .thumbnail { max-width: 150px; margin: 10px; border: 2px solid white; }
        .grid { display: flex; flex-wrap: wrap; justify-content: center; }
        #exif-box { background: rgba(0,0,0,0.8); padding: 10px; display: none; white-space: pre; text-align: left; margin: auto; max-width: 80vw; }
    </style>
</head>
<body>
<div id="exifModal" style="
    display: none;
    position: fixed;
    z-index: 1000;
    left: 10%;
    top: 10%;
    width: 80%;
    height: 80%;
    background-color: gray;
    border: 2px solid #444;
    box-shadow: 0 0 10px rgba(0,0,0,0.5);
    overflow: auto;
    padding: 20px;
    font-family: monospace;
">
    <button onclick="toggleExif()" style="position: absolute; top: 10px; right: 10px;">Close</button>
    <pre id="exifData" style="white-space: pre-wrap;"></pre>
</div>

<script>
 let mode="thumbnails";
  </script>
<div id="container">
    {% if image %}
  <script>
    mode = "image";
    </script>
<img src="/image" id="mainImage" style="max-width: 100%; max-height: 100vh;">
        <div id="exif-box"></div>
    {% else %}
        <script>
        mode="thumbnails";
        </script>
        <div class="grid">
            {% for img in images %}
                <a href="/?image={{ loop.index0 }}"><img src="/image/{{ img }}" class="thumbnail"></a>
            {% endfor %}
        </div>
    {% endif %}
</div>
<script>
    let exifVisible = false;


function toggleExif() {
    const modal = document.getElementById("exifModal");
    const exifBox = document.getElementById("exifData");

    if (exifVisible) {
        modal.style.display = "none";
    } else {
        fetch("/exif")
            .then(res => res.json())
            .then(data => {
                exifBox.textContent = data.exif || "No EXIF data found.";
                modal.style.display = "block";
            })
            .catch(err => {
                exifBox.textContent = "Error loading EXIF data.";
                modal.style.display = "block";
            });
    }

    exifVisible = !exifVisible;
}

document.addEventListener("keydown", (e) => {
    if (e.key === "e") toggleExif();
    else if (e.key === "n") {
    fetch("/nav/next").then(() => {
        document.getElementById("mainImage").src = "/image?t=" + new Date().getTime();
    });
}
else if (e.key === "p") {
    fetch("/nav/prev").then(() => {
        document.getElementById("mainImage").src = "/image?t=" + new Date().getTime();
    });
}
   else if (e.key === "q"){
if(mode == "thumbnails") {
fetch("/close");
return;
}
document.location.href = "/";}
});




</script>
</body>
</html>
"""


def find_free_port(start=5000, max_tries=100):
    for port in range(start, start + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
    raise RuntimeError("No free port found")


@app.route("/close")
def close():
    global window
    if window:
        window.destroy()

    return ("close");


@app.route("/")
def home():
    global index
    image = request.args.get("image")
    print("Image:", image)
    if image:
        try:
            index = int(image)
        except:
            index = 0
        print("Sending image:", index, "of", len(rel_paths))
        print("path:", rel_paths[index])
        return render_template_string(HTML_TEMPLATE, image=rel_paths[index], images=[])
    return render_template_string(HTML_TEMPLATE, image=None, images=rel_paths)


@app.route("/image")
def serve_current_image():
    global index
    filename = rel_paths[index]
    return send_from_directory(base_dir, filename)


@app.route("/image/<path:filename>")
def serve_image(filename):
    print(filename)
    return send_from_directory(base_dir, filename)


@app.route("/nav/<direction>")
def navigate(direction):
    print("Navigating:", direction, "Total images:", len(rel_paths))
    global index
    if direction == "next":
        index = (index + 1) % len(rel_paths)
    elif direction == "prev":
        index = (index - 1) % len(rel_paths)
    print("New index:", index)
    print("Image path:", rel_paths[index])
    return render_template_string(HTML_TEMPLATE, image=rel_paths[index], images=[])


@app.route("/exif")
def exif():
    full_path = os.path.join(base_dir, rel_paths[index])
    try:
        img = Image.open(full_path)
        exif_data = img._getexif()
        if exif_data:
            exif = {ExifTags.TAGS.get(k, k): str(v) for k, v in exif_data.items()}
            print(jsonify(exif="\n".join([f"{k}: {v}" for k, v in exif.items()])))

            return jsonify(exif="\n".join([f"{k}: {v}" for k, v in exif.items()]))
        else:
            return jsonify(exif=f"Width: {img.width}\nHeight: {img.height}")
    except Exception as e:
        return jsonify(exif=f"Error reading EXIF: {e}")


@app.route("/shutdown", methods=["POST"])
def shutdown():
    shutdown_func = request.environ.get("werkzeug.server.shutdown")
    if shutdown_func:
        shutdown_func()
    return "Shutting down..."


window = None


def start_image_viewer(bdir, paths):
    global base_dir, rel_paths, index, window
    base_dir = bdir
    rel_paths = paths
    index = 0
    port = find_free_port()
    url = f"http://localhost:{port}"

    def run_server():
        import logging
        log = logging.getLogger('werkzeug')
        log.setLevel(logging.ERROR)
        app.run(port=port, debug=False, use_reloader=False)

    Thread(target=run_server, daemon=True).start()
    window = webview.create_window("Image Viewer", url)
    webview.start()


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
            result.update(range(start - 1, end))
        else:
            result.add(int(part) - 1)
    return sorted(result)


def display_image(base_dir, rel_paths):
    try:
        start_image_viewer(base_dir, rel_paths)
    except Exception as e:
        print(f"Error displaying image: {e}")


def main():
    parser = argparse.ArgumentParser(description="Display an image from file or reference data.")
    parser.add_argument("-f", "--file", help="Path to image file (optional)")
    parser.add_argument("--reference", help="Hex-encoded JSON list of records (optional)")
    parser.add_argument("number", nargs="?", help="1-based index to select from reference")

    args = parser.parse_args()

    if args.file:
        base = os.path.dirname(args.file)
        rel = [os.path.basename(args.file)]
        display_image(base, rel)
    elif args.reference:
        if args.number is None:
            print("Error: --reference requires a positional number argument.")
            sys.exit(1)

        reference = decode_reference(args.reference)
        records = reference.get("files")
        folder = reference.get("directory") or "."

        indexes = parse_number_arg(args.number)

        if not isinstance(records, list) or not indexes:
            print("Error: Invalid records or index.")
            sys.exit(1)

        to_display = []
        for index in indexes:
            if index < 0 or index >= len(records):
                print(f"Error: Index {index + 1} out of range.")
                sys.exit(1)
            to_display.append(records[index])

        full_paths = [item["path"] for item in to_display]
        common_root = os.path.commonpath(full_paths)

        for item in to_display:
            item["name"] = os.path.relpath(item["path"], common_root)

        relative_paths = [x["name"] for x in to_display]
        display_image(common_root, relative_paths)
    else:
        print("Error: Either --file or --reference must be provided.")
        sys.exit(1)


if __name__ == "__main__":
    main()
