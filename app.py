from flask import Flask, jsonify, Response
from flask_cors import CORS
import urllib.request
import urllib.error
import json
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__)
CORS(app)  # Allow requests from SharePoint

SITES = [
    {"name": "Central Operations FMO",        "addr": "2540 Westinghouse Blvd", "url": "http://63.46.75.214:10001"},
    {"name": "Northeast Remote Ops FMO",       "addr": "7702 Burwell St",        "url": "http://166.146.80.90:10001"},
    {"name": "Heavy Equipment Shop FMO",       "addr": "4120 New Bern Ave",       "url": "http://63.46.75.226:10001"},
    {"name": "Public Utilities Field Ops RW",  "addr": "3304 Lake Woodard Dr",   "url": "http://63.46.75.230:10001"},
    {"name": "Wilders Grove SWS",              "addr": "610 Beacon Lake Dr",     "url": "http://63.46.75.218:10001"},
    {"name": "Marsh Creek PRCR",               "addr": "4225 Daly Rd",           "url": "http://63.46.75.228:10001"},
    {"name": "Neuse River NRRF RW",            "addr": "8500 Battle Bridge Rd",  "url": "http://63.46.75.227:10001"},
]

TIMEOUT = 20

def fetch_site(site):
    result = {
        "name":   site["name"],
        "addr":   site["addr"],
        "url":    site["url"],
        "tanks":  [],
        "alarms": [],
        "error":  None
    }
    try:
        # Fetch tank data
        cgi_url = site["url"] + "/cgi-bin/getTankData.cgi?dataset=dynData"
        req = urllib.request.Request(cgi_url, headers={"User-Agent": "ATG-Dashboard/1.0"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            cgi_data = json.loads(resp.read().decode())

        # Fetch inventory page for fuel types
        inv_url = site["url"] + "/php/Inventory.php"
        req2 = urllib.request.Request(inv_url, headers={"User-Agent": "ATG-Dashboard/1.0"})
        with urllib.request.urlopen(req2, timeout=TIMEOUT) as resp2:
            inv_html = resp2.read().decode()

        # Fetch alarms JSON
        alarm_url = site["url"] + "/php/getAlarms.php?current=1"
        req3 = urllib.request.Request(alarm_url, headers={"User-Agent": "ATG-Dashboard/1.0"})
        with urllib.request.urlopen(req3, timeout=TIMEOUT) as resp3:
            try:
                result["alarms"] = json.loads(resp3.read().decode())
            except Exception:
                result["alarms"] = []

        if not cgi_data.get("tankData"):
            result["error"] = "No tank data"
            return result

        result["invHtml"]  = inv_html
        result["cgiData"]  = cgi_data

    except urllib.error.URLError as e:
        result["error"] = f"Network error: {e.reason}"
    except Exception as e:
        result["error"] = str(e)

    return result


@app.route("/api/tanks")
def api_tanks():
    with ThreadPoolExecutor(max_workers=len(SITES)) as ex:
        results = list(ex.map(fetch_site, SITES))
    return jsonify(results)


@app.route("/health")
def health():
    return "OK"


@app.route("/")
def index():
    return Response(open("dashboard.html").read(), mimetype="text/html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
