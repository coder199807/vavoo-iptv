import requests

API = "https://huhu.to/api/v2/live"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://huhu.to/"}

def fetch():
    try:
        r = requests.get(API, headers=HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        with open("huhu.m3u", "w", encoding="utf-8") as f:
            f.write("#EXTM3U\n")
            for ch in data.get("channels", []):
                name = ch["name"]
                url = ch["url"]
                if name and url:
                    f.write(f"#EXTINF:-1,{name}\n{url}\n")
        print(f"huhu.to: {len(data.get('channels', []))} Sender.")
    except Exception as e:
        print(f"huhu.to Fehler: {e}")
        open("huhu.m3u", "w").close()

if __name__ == "__main__":
    fetch()
