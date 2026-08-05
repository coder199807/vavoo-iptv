import requests

API = "https://kool.to/api/channels"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://kool.to/"}

def fetch():
    try:
        r = requests.get(API, headers=HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        with open("kool.m3u", "w") as f:
            f.write("#EXTM3U\n")
            for ch in data:
                name = ch.get("title")
                url = ch.get("stream_url")
                if name and url:
                    f.write(f"#EXTINF:-1,{name}\n{url}\n")
        print(f"kool.to: {len(data)} Sender.")
    except Exception as e:
        print(f"kool.to Fehler: {e}")
        open("kool.m3u", "w").close()

if __name__ == "__main__":
    fetch()
