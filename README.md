# Yılan.io

Tarayıcıda oynanan neon yılan oyunu: tek başına botlara karşı veya internet üzerinden arkadaşlarla bir odada.

**Oyna: https://muhammedcihansahin.github.io/dolaniyo/** (ücretsiz, kurulum gerekmez; telefonda da çalışır)

Yol haritası ve tasarım kararları: [CURRENT_PLAN.md](CURRENT_PLAN.md).

## Gereksinimler

- Node.js 22.12+ (önerilen: 24 LTS)

Bu bilgisayarda Node.js sisteme kurulu değil; taşınabilir sürüm `C:\Users\mciha\.tools\node`
klasöründe. Komutları çalıştırmadan önce o terminal oturumu için yola ekleyin:

```powershell
$env:Path = "C:\Users\mciha\.tools\node;" + $env:Path
```

(Node.js'i nodejs.org'dan sisteme kurarsanız bu adıma gerek kalmaz.)

## Kurulum

```bash
npm install
```

Proje klasörü kopyalandıysa veya taşındıysa `npm install`'ı yeniden çalıştırın: paketler arası
bağlantılar (`node_modules/@yilan/*`) kopyalamada bozulur.

## Oynamak

En kolayı: proje klasöründeki **`Oyna.exe`** başlatıcısına çift tıklayın. Açılan pencerede:

- **▶ Başlat**: Node.js'i bulur, eksik paketleri kurar, yerel sunucuyu (8080) ve oyunu (5173) başlatır;
  "Sunucu hazır olunca oyunu tarayıcıda aç" işaretliyse tarayıcıyı da açar. Basınca **■ Durdur** olur.
- **Oyunu aç**: oyunu tarayıcıda açar (sunucu kapalıysa önce başlatır).
- **Yeniden başlat**, **Kayıtlar** (sunucu çıktısı; bir hata olursa kendiliğinden açılır).
- **Aynı ağdaki arkadaşlar** satırındaki adresi **Kopyala** ile arkadaşlarınıza gönderin.
- Önceki bir pencereden kalan eski sunucu portu tutuyorsa başlatıcı bunu söyler ve sorarak kapatır.

**Başlatıcı penceresini kapatınca sunucu ve oyunun adresi de kapanır** (başlatıcı çökse ya da Görev
Yöneticisi'nden sonlandırılsa bile). Ayarlar `%LOCALAPPDATA%\Yilan.io\baslatici.ini` dosyasında tutulur.
Başlatıcının kaynağı `tools/launcher/Launcher.cs`; değiştirince `npm run launcher` ile yeniden derlenir
(Windows'taki .NET Framework derleyicisi yeterli, ek kurulum gerekmez).

- **Tek başına**: menüdeki **Ayarlar**'dan bot sayısını (0–32) ve oyun hızını (%50–%200) seçin, takma
  adınızı yazıp **Oyna**'ya basın. Başka pencereye geçince botlu oyun duraklar.
- **Arkadaşlarla**: **Oda kur**'a basın (oda, sürgülerdeki bot sayısı ve hızla kurulur). Menüde 5 karakterlik oda
  kodu ve bir bağlantı çıkar; arkadaşlarınız kodu **Oda kodu** kutusuna yazıp **Katıl**'a basar ya da
  bağlantıyı açar. Odada en fazla 16 kişi olabilir. Ölünce aynı odada tekrar **Oyna** denir;
  **Odadan çık** tek kişilik oyuna döndürür. Odada sizden başka en az bir kişi varsa siz başka pencereye
  geçseniz de oyun akmaya devam eder; odada tek başınaysanız oda da duraklar.

### Odalar nasıl çalışır (sunucusuz)

Odayı kuran kişinin **tarayıcısı odanın sunucusudur**: dünya, botlar ve 30 Hz döngü o sekmede çalışır
(`shared/src/net/RoomHost.ts`). Hiçbir yerde oda kaydı ya da veritabanı yoktur.

- Oda kodu, ücretsiz PeerJS eşleştirme sunucusunda (`0.peerjs.com`) kurucunun geçici kimliği olur
  (`yilan-io-K7QXP`). Katılan bu kimliği bulur, sonra tüm oyun verisi iki tarayıcı arasında doğrudan
  (WebRTC veri kanalı) akar. Doğrudan bağlantı kurulamayan ağlarda PeerJS'in ücretsiz TURN aktarıcısı kullanılır.
- **Kurucu sekmeyi kapatırsa ya da Odadan çık derse oda biter.** Kurucu sayfayı yenilerse oda aynı kodla
  yeniden kurulur (yeni dünya) ve arkadaşlar birkaç saniye içinde kendiliğinden yeniden bağlanır.
- Kurucu başka sekmeye geçse de oda akar (döngü bir Worker saatinden beslenir). Kurucunun yükleme hızı
  önemlidir: her kişiye saniyede ~30 küçük mesaj gider.
- Odalar internet gerektirir (eşleştirme için); oyunun kendisi için sunucu gerekmez.

## Geliştirme

Terminalden istemci ve oda sunucusunu birlikte başlatmak için:

```bash
npm run dev
```

Tarayıcıda http://localhost:5173 adresini açın. Odalar tarayıcıda çalıştığı için yalnızca istemci de
yeterlidir: `npm run dev:client`. Yerel Node sunucusu (8080) yalnızca, oyun `localhost`'tan açıldığında
paylaşım bağlantısına bilgisayarın ağ adresini koymak için `/api/lan` verir.

## Yayına alma (GitHub Pages, ücretsiz, sürekli açık)

Oyun tamamen statik bir sitedir (`packages/client/dist`); sunucu gerekmez. Odalar oyuncuların
tarayıcılarında çalıştığı için site herkese açık bir adreste durunca dünyanın her yerinden herkes
oynayabilir ve oda kurup katılabilir.

**Adres: https://muhammedcihansahin.github.io/dolaniyo/**

`main` dalına her push'ta `.github/workflows/pages.yml` testleri çalıştırır, oyunu derler ve GitHub
Pages'e yükler (1–2 dakika). Bilgisayarın açık kalmasına gerek yoktur; site GitHub'da sürekli açık kalır.

Bir kez yapılacak ayar: GitHub'da depo → **Settings → Pages → Build and deployment → Source:
GitHub Actions**. Bu ayardan önce çalışmış bir yayın başarısız olduysa **Actions → GitHub Pages → Run
workflow** ile yeniden çalıştırın.

Güncelleme: değişiklikleri `main`'e gönderin (`git push`); site kendiliğinden yenilenir. İlerleme ve
hatalar depodaki **Actions** sekmesinde görünür.

### Cloudflare (isteğe bağlı)

Aynı derleme Cloudflare'e de yüklenebilir (`wrangler.jsonc`, `npm run deploy`). Ancak bazı Türk internet
sağlayıcıları `*.pages.dev` adreslerini engelliyor; herkesin erişebilmesi için GitHub Pages adresini
paylaşın. Cloudflare için bir kez `npm run deploy:login` ve `npm run deploy:setup`, her güncellemede
`npm run deploy`.

## Diğer komutlar

| Komut                          | Açıklama                                                                    |
| ------------------------------ | --------------------------------------------------------------------------- |
| `npm test`                     | Birim testleri (Vitest)                                                     |
| `npm run typecheck`            | Tüm paketlerde TypeScript tip kontrolü                                      |
| `npm run build`                | İstemciyi `packages/client/dist` klasörüne derler                           |
| `npm start`                    | Yerel sunucu: derlenmiş istemciyi, `/api/lan` ve `/health`'i 8080'den sunar |
| `npm run deploy`               | Derleyip Cloudflare Pages'e yükler (GitHub Pages için `main`'e push yeter)  |
| `npm run bench -- 120 20 5000` | Başsız simülasyon ölçümü (saniye, bot sayısı, arena yarıçapı)               |
| `npm run format`               | Prettier ile biçimlendirme                                                  |
| `npm run launcher`             | `Oyna.exe` başlatıcısını `tools/launcher/Launcher.cs`'ten yeniden derler    |

## Kontroller

- **Fare**: yön · **Sol tık / Space**: hızlan (skor harcar)
- **←/→ veya A/D**: klavyeyle dön · **Esc**: menüye dön

## Proje yapısı

```
packages/
  shared/   oyun kuralları ve simülasyon (istemci + sunucu ortak), botlar, oda protokolü, testler
  client/   Vite + PixiJS istemcisi: çizim, girdi, menü, HUD, çevrimdışı oyun, oda bağlantısı
  server/   yerel Node.js sunucusu: statik dosyalar, /api/lan, /health (odalar tarayıcıda çalışır)
tools/      simbench (başsız simülasyon ölçümü), launcher (Oyna.exe başlatıcısının kaynağı)
```
