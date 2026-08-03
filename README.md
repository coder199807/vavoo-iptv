# vavoo-iptv

Bu proje, Vavoo.to servisi üzerinden erişilebilen canlı yayın kaynaklarını M3U ve EPG (elektronik program rehberi) formatında bir araya getiren, GitHub Actions ile otomatik olarak güncellenen küçük bir teknik projedir. Amacı; bir Cloudflare Worker, yardımcı scriptler ve otomasyon iş akışlarının (workflows) IPTV/M3U/EPG ekosisteminde nasıl bir arada çalışabileceğini göstermektir.

## Önemli Uyarı — Telif Hakları ve Sorumluluk

Bu proje, **Vavoo.to veya herhangi bir yayıncı kuruluşla resmi bir bağlantıya sahip değildir** ve bu depoda yer alan kod, herhangi bir yayın içeriğinin telif hakkına sahip olduğu anlamına gelmez.

Vavoo.to üzerinden erişilen kanalların büyük bir kısmı, ilgili ülkelerin yayın lisanslama sistemleri dışında, **yetkisiz (korsan) şekilde** dağıtılmaktadır. Bu tür bir dağıtım:

- İçerik sahiplerinin ve yayıncı kuruluşların haklarını ihlal eder,
- Birçok ülkede hukuki ve cezai yaptırımlara tabi olabilir,
- Emek veren yapımcı, yayıncı ve içerik üreticilerine zarar veren, **etik olarak da yanlış bir davranıştır.**

Bu depo **yalnızca teknik/eğitim amaçlıdır**; M3U, EPG ve yayın çözümleme mimarisinin nasıl kurgulanabileceğini göstermek içindir. Bu kodu kullanarak yetkisiz yayın içeriğine erişmek, dağıtmak veya bunu ticari/kitlesel şekilde yaymak **tamamen kullanıcının kendi kararı ve kendi sorumluluğundadır.** Proje sahibi bu tür bir kullanımı teşvik etmez, önermez ve sonuçlarından sorumlu tutulamaz.

## İçerik

- `worker/` — Yayın kaynaklarını çözümleyip yönlendiren Cloudflare Worker kodu
- `scripts/` — Kanal listesini ve verileri güncelleyen yardımcı scriptler
- `.github/workflows/` — Listeleri belirli aralıklarla otomatik güncelleyen GitHub Actions tanımları
- `iptv.m3u` — Oluşturulan örnek M3U yayın listesi
- `epg.xml` — Oluşturulan örnek EPG (program rehberi) verisi
- `package.json` — Proje bağımlılıkları ve script tanımları

## Nasıl çalışıyor

1. Scriptler, Vavoo.to tarafında yayınlanan kanal ve akış bilgilerini toplar.
2. Bu veriler M3U ve EPG formatına dönüştürülür.
3. Worker, istemciden gelen istekleri karşılayıp ilgili akışa yönlendirme/çözümleme işini yapar.
4. GitHub Actions workflow'u bu süreci belirli periyotlarla otomatik tekrarlar.

## Kurulum (yerel geliştirme için)

```bash
git clone https://github.com/kadirmetin/vavoo-iptv.git
cd vavoo-iptv
npm install
```

Worker'ı yerelde çalıştırmak ve script'leri tetiklemek için `package.json` içindeki script tanımlarına bakabilirsiniz.
