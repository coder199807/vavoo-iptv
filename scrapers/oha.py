import requests

API = "https://oha.to/api/v1/channels"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://oha.to/"}

def fetch():
    try:
        r = requests.get(API, headers=HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
        with open("oha.m3u", "w") as f:
            f.write("#EXTM3U\n")
            for ch in data:
                name = ch.get("title") or ch.get("name", "")
                url = ch.get("url") or ch.get("stream", "")
                if name and url:
                    if "vavoo" in url.lower():
                        url = f"https://VA-CLEANER.DEINE-DOMAIN.workers.dev/?url={url}"
                    f.write(f"#EXTINF:-1,{name}\n{url}\n")
        print(f"oha.to: {len(data)} Sender gespeichert.")
    except Exception as e:
        print(f"oha.to Fehler: {e}")
        open("oha.m3u", "w").close()

if __name__ == "__main__":
    fetch()
