import requests

API = "https://huhu.to/api/v2/live"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://huhu.to/"}

def fetch():
    try:
        r = requests.get(API, headers=HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        with open("huhu.m3u", "w") as f:
            f.write("#EXTM3U\n")
            for ch in data.get("channels", []):
                name = ch["name"]
                url = ch["url"]
                if "vavoo" in url.lower():
                    url = f"https://VA-CLEANER.DEINE-DOMAIN.workers.dev/?url={url}"
                f.write(f"#EXTINF:-1,{name}\n{url}\n")
        print(f"huhu.to: {len(data.get('channels', []))} Sender.")
    except Exception as e:
        print(f"huhu.to Fehler: {e}")
        open("huhu.m3u", "w").close()

if __name__ == "__main__":
    fetch()
