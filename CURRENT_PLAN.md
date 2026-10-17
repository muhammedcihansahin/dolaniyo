# CURRENT PLAN — Çok Oyunculu Yılan (.io) Oyunu

> Bu dosya projenin **yaşayan plan belgesidir**. Her faz bittikçe ilgili kutucuklar `[x]` yapılır, "Mevcut Durum" bölümü güncellenir.
> Son güncelleme: 2026-10-17

---

## 0. Mevcut Durum

| Faz | Başlık | Durum |
|-----|--------|-------|
| 0 | Proje iskeleti ve araçlar | ✅ Bitti (ilk commit hariç) |
| 1 | Çekirdek simülasyon + tek oyunculu (botlarla) oynanabilir sürüm | ✅ Bitti |
| 2 | Görsel kimlik (arka plan, yılan, yem, sınır, kamera) | ⬜ |
| 3 | Menü, modallar, HUD | ⬜ |
| 4 | Yetkili (authoritative) çok oyunculu sunucu | ⬜ |
| 5 | Netcode cilası (interpolasyon, tahmin, bant genişliği) | ⬜ |
| 6 | Odalar (@oda), kalıcı skor tablosu (Günlük/Aylık/Tüm Zamanlar) | ⬜ |
| 7 | Mobil dokunmatik kontroller + gamepad | ⬜ |
| 8 | Performans, test, cila | ⬜ |
| 9 | Yerel / LAN çalıştırma + Docker hazırlığı | ⬜ |
| ~~10~~ | ~~Portal sarmalayıcı sayfa~~ | ❌ Kapsam dışı (karar: sadece oyun) |

Sıradaki adım: **Faz 2 (görsel kimlik)**. Oyun şu an `npm run dev:client` ile tarayıcıda botlara karşı oynanabiliyor; çalıştırma talimatları [README.md](README.md)'de.

### 0.1 Alınan Kararlar (2026-10-17)

| Konu | Karar | Etkisi |
|------|-------|--------|
| Oyunun adı | **Yılan.io** | Logo "Yılan" (turkuaz) + ".io" (sarı). Kod/paket/anahtar adlarında ASCII `yilan` kullanılır. |
| Çok oyunculu sunucu | **Önce botlarla, sonra sunucu** | Faz 1–3 tarayıcıda botlarla tam oyun; Faz 4'te aynı `shared/sim` kodu sunucuya taşınır. |
| Barındırma | **Şimdilik yerel** | Oyun kendi bilgisayarda ve yerel ağda (LAN) oynanır; Docker dosyaları hazır tutulur, gerçek yayına alma sonraya. |
| Portal sayfası | **Sadece oyun** | Faz 10 kaldırıldı. Menü altında kısa hakkında/SSS bölümü kalır. |
| Render | **PixiJS (WebGL)** | §4 ve §9 bu varsayımla yazıldı. |
| Arayüz dili | **Türkçe + İngilizce** | Tarayıcı diline göre otomatik seçim, ayarlardan değiştirilebilir (§10.6). |

### 0.2 Uygulama Notları ve Plandan Sapmalar (Faz 0–1, 2026-10-17)

- **Node.js**: Bilgisayarda kurulu değildi; resmî taşınabilir Node.js 24.22.0 LTS `C:\Users\mciha\.tools\node` klasörüne açıldı (SHA-256 doğrulandı). Terminalde kullanmak için README'deki `$env:Path` satırı gerekir.
- **Sürümler**: TypeScript 6.0.3 (TS 7'nin yeni yerel derleyicisi yerine, ekosistem uyumu için), Vite 8.3.2, PixiJS 8.22.0, Vitest 5.0.3, tsx 4.23.15.
- **ESLint ertelendi**: Şimdilik yalnızca Prettier + `tsc` (strict, unused kontrolleri açık). ESLint Faz 8'de eklenecek.
- **Bot kodu `shared` paketinde** (`shared/src/sim/bots/`): Hem çevrimdışı istemci hem sunucu aynı `BotController`'ı kullanacak; §6'daki `server/src/BotController.ts` ayrıca gerekmeyecek.
- **Oynanış ayarları (oynayarak/ölçerek değiştirildi)**:
  - `foodDensity` 1/9000 → **1/30000**: orijinal oyunla yan yana bakınca ekranda ~5 kat fazla yem vardı.
  - `headZoneK` 2 → **1**: kafa bölgesi yalnızca kafanın kendisi; aksi halde ölümlerin %70'i kafa-kafaydı.
  - Botlar başka kafaların çevresine ekstra pay bırakıyor. `npm run bench` ölçümü (50 bot, R=6000): tick ~0.25 ms; ölümlerin ~2/3'ü gövdeye çarpma, sınıra çarpan bot yok.
- **Çevrimdışı arena**: R=5000 + 24 bot (ilk doldurmada üstel dağılımlı rastgele skorlar, oda canlı görünsün diye).
- **Erken yapılanlar** (sonraki fazlardan küçük parçalar, oynanabilirlik için): basit HUD (skor tablosu + kendi satırı, FPS/Skor/Sıra, mini harita), basit menü (logo, takma ad, Oyna, dönen ipuçları, son skor), doğma yakınlaşma animasyonu, i18n altyapısı (`t()`, tr/en, otomatik dil seçimi), klavyeyle dönme, Esc ile menüye dönüş. Faz 2–3 bunları orijinale tam benzetecek.
- **Performans ölçümü** (1024×768, 25 yılan, ~2600 yem): kare başına güncelleme ~0.22 ms, çizim + GPU ~0.26 ms. Hata ayıklama için geliştirme modunda `window.__yilan` erişilebilir.
- **Yem ve yılan ayarları (oyuncu geri bildirimiyle, 2026-10-17)**:
  - Boost yemi çok sıktı: kaybın yem olan oranı %60 → **%40**, tek yemin değeri `clamp(skor × 0.002, 1.5, 6)` (eskiden 0.5–2). Sonuç: saniyede ~7 yem yerine ~2.
  - Mıknatıs takılıyordu: yem 30 Hz'de zıplıyordu. `FoodStore` artık taşındığı tick'in başındaki konumu (`px/py/movedAt`) tutuyor, istemci kafa gibi yemi de interpolasyonla çiziyor. Yenen yem kaybolmak yerine ~0.16 sn'de kafaya akıp küçülüyor (`foodEaten` olayına `kind` eklendi).
  - Yem hiç tükenmesin: yenen ortam yemi yendiği yerin 500–1600 u yakınında yeniden doğuyor (bölge boşalmıyor). Yeni yem büyüyerek belirir, süresi dolan yem son 1.5 sn'de küçülerek söner.
  - Büyüme sınırsız: yarıçaptaki 48 üst sınırı kaldırıldı (log büyüme sürüyor); çarpışma/bot sorguları `BodyGrid.maxRadius` kullanıyor.
  - Ölüm yemi orijinal gibi: gövde boyunca her `r × 0.5`'te bir, yarıçapı `r × 0.7–0.95` olan yumuşak kenarlı parlak küreler; üst üste binerek yılanın şeklini çiziyor. Ölen yılan 0.3 sn'de soluyor.
  - Yılan boncukları baştan kuyruğa akan bir dalgayla büyüyüp küçülüyor (±%28, hızlanırken dalga iki kat hızlı).
- **Sunucu (Faz 0 düzeyi)**: `/health` + derlenmiş istemciyi sunma + LAN adreslerini yazdırma; dizin dışına çıkan istekler reddediliyor. WebSocket Faz 4'te.

---

## 1. Hedef

https://slithergame.io/ sayfasına gömülü oyunun (sayfa, oyunu `iframe` içinde **gulper.io**'dan yüklüyor) oynanış, arayüz ve his olarak **birebir eşdeğerini** sıfırdan yazmak:

- Tarayıcıda çalışan, indirme gerektirmeyen, gerçek zamanlı çok oyunculu yılan oyunu.
- Fare ile yön, sol tık / Space ile hızlanma; hızlanırken uzunluk ve skor azalır.
- Dairesel arena, altıgen ızgaralı koyu lacivert arka plan, parlayan yem noktaları, boncuk dizili neon yılanlar.
- Oda içi canlı skor tablosu, mini harita, FPS/Ping/Skor/Sıra göstergesi.
- Ana menü: logo, takma ad + Play, dönen ipuçları, Yardım / Ayarlar / En Yüksek Skorlar düğmeleri, renk seçici.
- `TakmaAd@OdaAdi` ile özel oda.
- Mobil (dokunmatik: joystick / ok modu) ve gamepad desteği.

### 1.1 Özgünlük / hukuki not (önemli)
- Oyun **mekanikleri** kopyalanabilir; ancak gulper.io'nun **adı, logosu, kaynak kodu, görselleri, yazıları** kopyalanmayacak. Tüm kod, grafik, ikon ve metinler bizim tarafımızdan özgün olarak üretilecek.
- Oyunun adı: **Yılan.io** (karar verildi). Logo bizim tarafımızdan özgün olarak çizilecek.
- Menüdeki "App Store" rozeti, reklamlar ve portal sayfası kapsam dışı.

---

## 2. Referans Analizi (gözlemlenenler)

Aşağıdakiler oyun canlı oynanarak ve arayüzü incelenerek not edildi. Bunlar **yapılacak özelliklerin listesidir**.

### 2.1 Ana menü ekranı
- Tam ekran koyu lacivert, ortası hafif açık radyal gradyan arka plan.
- Büyük, parlak (glow) yuvarlak hatlı logo yazısı: ana kısım turkuaz/camgöbeği, ".io" kısmı sarı. → Biz kendi logomuzu aynı stilde (iki renkli neon) yapacağız.
- Ortada: `Nickname` metin kutusu + yanında sarı çerçeveli `Play` düğmesi (Enter ile de başlar).
- Altında **birkaç saniyede bir değişen ipucu satırı**, örnek konular:
  - Hızlanmak için sol fare tuşu veya Space'e basılı tut.
  - Yön değiştirmek için fareyi hareket ettir.
  - Özel odaya girmek için takma addan sonra `@` ve oda adı yaz.
  - Çarpışmalardan kaçın.
- Sağ üstte üç ikon düğme (yan yana, ~53px @1024×768):
  1. **Yeşil "?"** → Yardım / Oyun hakkında
  2. **Mavi dişli** → Ayarlar modalı
  3. **Sarı kupa** → En Yüksek Skorlar modalı
- Sağ altta **renk seçici**: seçili renkte yuvarlak yılan kafası önizlemesi (iki göz). Oyuncunun yılan rengini belirler.
- Alt ortada: © yıl • About • Privacy • sürüm numarası (örn. `v1.0.0`).
- Sayfa aşağı kaydırılabilir: altta "Oyun hakkında", "Kontroller", "Gamepad", "Odalar", "Ayarlar", "SSS" metinleri (SEO içeriği) ve "yukarı dön" düğmesi.

### 2.2 Ayarlar modalı
Koyu lacivert, ince açık mavi çerçeveli panel, sağ üstte ⊗ kapat. Her satır "Etiket: **değer**" şeklinde; altı çizili değere tıklayınca sıradaki seçeneğe geçer (toggle/cycle):

| Ayar | Seçenekler | Varsayılan |
|------|-----------|------------|
| Leaderboard | visible / hidden | visible |
| Nicknames | visible / hidden | visible |
| Minimap | visible / hidden | visible |
| Join bigger rooms | auto / yes / no | auto |
| Flashes | off / on | off |
| Graphics | low / normal / high | normal |
| Framerate | low / normal / high | high |
| Controls (yalnızca dokunmatik cihazda görünür) | mouse / joystick / arrow | cihaza göre |

### 2.3 En Yüksek Skorlar (Top scores) modalı
- Başlık + üç sekme: **Daily / Monthly / All-Time**.
- Kaydırılabilir liste: `sıra. takma ad ........ skor` (en az 12 satır görünür, 50'ye kadar).
- Bazı skorların yanında üst simge olarak **sıra değişimi** (örn. `⁻¹`, `⁻²`).
- Unicode / emoji takma adlar destekleniyor.

### 2.4 Oyun içi
- **Bağlanırken**: siyah ekranda ortada dönen halka (koyu mavi halka üzerinde dönen sarı yay).
- **Doğma (spawn)**: kamera önce uzaktan (zoom out) başlar, ~1 sn içinde yumuşakça yakınlaşır.
- **Arena**: büyük **daire**; sınırı kalın, parlayan açık mavi halka. Dışarısı daha karanlık.
- **Arka plan**: koyu lacivert, ince **noktalı çizgilerle altıgen (hex) ızgara** + çok ince nokta dokusu. Uzaklaşınca ızgara soluklaşır.
- **Yem**: farklı renk (camgöbeği, sarı, beyaz, pembe, mor, yeşil…) ve boyutlarda parlayan küçük daireler.
- **Yılan görünümü**: siyaha yakın koyu bir "tüp" gövde; dış kenarında yılan renginde ince parlak kontur; tüpün içinde baştan kuyruğa dizili **renkli boncuklar (daireler)**. Kafa ucunda iki küçük göz. Büyük yılanlar daha kalın ve uzun.
- **Takma ad**: yılanın altında/yanında küçük yazı (ayardan gizlenebilir).
- **HUD**:
  - Sağ üst: oda skor tablosu (ilk 10) — `1. AD   skor`. Oyuncu ilk 10'da değilse en alta kendi gerçek sırasıyla eklenir ve vurgulanır (örn. `19. Guest444  25`). İnce kesikli çerçeve.
  - Sol alt: `FPS: a/b`, `Ping: 64~3` (ortalama~sapma), `Score: 25`, `Rank: 19 of 22`.
  - Sağ alt: dairesel **mini harita** (arena sınırı halka, kendi konum beyaz nokta, diğer önemli noktalar soluk).
- **Ölünce**: doğrudan ana menüye dönülür (takma ad korunur).
- Boş takma adla oynanırsa `Guest###` adı verilir.
- Başlangıç skoru **10**.

### 2.5 Kurallar (resmî açıklamalardan çıkarılan)
- Fareyle yön, sol tık veya Space basılıyken hızlanma. Hızlanırken uzunluk ve skor yavaş yavaş azalır.
- Arena sınırına veya **başka bir oyuncunun gövdesine** çarpan ölür.
- **Kafa-kafa çarpışmada** ikisi de ölür; **istisna**: oyuncu odada 1. sıradaysa veya rakip ondan çok daha küçükse hayatta kalır.
- Kendi gövdene çarpmak öldürmez (kendi içinden geçebilirsin).
- Ölen yılan topladığı enerjiyi yem olarak geride bırakır.
- Odalar: Herkese açık odalar otomatik; `Ad@Oda` ile özel oda. Özel oda, kısa süre içinde yeterli (≈8) oyuncu aynı oda adını girerse açılır; yoksa oyuncular ortak bir açık odaya alınır. Oda kapasitesi, odaya ilk katılan oyuncu sayısına göre belirlenir.
- Gamepad: çubuk ile yön, üst (omuz) tuşları ile hızlanma, Start ile oyuna başla, Back ile menüye dön.
- Dokunmatik: parmağı kaydırarak yön, başka bir parmakla basılı tutarak hızlanma.

### 2.6 slithergame.io sarmalayıcı sayfa (kapsam dışı)
Üst bar, reklam alanları, oyun iframe'i, oy/puan, "Diğer oyunlar" listesi, SEO makalesi, yorum formu. Karar gereği yapılmayacak; yalnızca kayıt için not edildi.

---

## 3. Kapsam

### 3.1 MVP (ilk oynanabilir çok oyunculu sürüm) — Faz 0–5
- Çekirdek kurallar, botlar, tek oda, menü + HUD, görsellerin büyük kısmı, WebSocket sunucusu.

### 3.2 Tam sürüm — Faz 6–9
- Özel odalar, kalıcı skor tablosu, mobil/gamepad, ayarların tamamı, performans, yerel/LAN çalıştırma ve Docker hazırlığı.

### 3.3 Kapsam dışı
- Mobil mağaza uygulaması, reklam entegrasyonu, hesap/giriş sistemi, ödeme, kostüm mağazası.
- slithergame.io tarzı portal sayfası.
- Şimdilik internete yayına alma (alan adı, TLS, VPS) — sonra karar verilecek.

---

## 4. Teknoloji Yığını

| Katman | Seçim | Gerekçe |
|--------|-------|---------|
| Dil | **TypeScript** (her yerde) | Ortak kod (simülasyon, protokol) istemci ve sunucuda aynen kullanılır. |
| Monorepo | **npm workspaces** | `shared`, `client`, `server` paketleri. |
| İstemci derleme | **Vite** | Hızlı geliştirme sunucusu, HMR, üretim derlemesi. |
| Render | **PixiJS v8** (WebGL, WebGPU'ya hazır) | Orijinal oyun da WebGL kullanıyor; binlerce sprite'ı (boncuk, yem) rahat çizer. Alternatif: saf Canvas 2D (daha basit, daha yavaş) — bkz. §20. |
| UI (menü/modallar) | Saf HTML + CSS (framework yok) | Az sayıda ekran; React gereksiz yük. |
| Sunucu | **Node.js 22 LTS** + **`ws`** | Hafif, hızlı WebSocket. |
| Kalıcılık | **SQLite** (`better-sqlite3`) | Skor tablosu için yeterli, kurulum gerektirmez. |
| Test | **Vitest** | Simülasyon birim testleri. |
| Kod kalitesi | ESLint + Prettier | |
| Çalıştırma | Şimdilik yerel/LAN: tek Node süreci (`npm start`); Docker dosyaları ileride yayın için hazır | Karar: şimdilik yerel (§17). |

---

## 5. Mimari

```
┌──────────────────────────── Tarayıcı (client) ─────────────────────────────┐
│  UI katmanı (HTML/CSS)   →  Menü, modallar, HUD overlay                     │
│  Input (fare/klavye/dokunmatik/gamepad) → hedef açı + boost                 │
│  NetClient (WebSocket, binary) ←→ sunucu                                    │
│  WorldState (sunucudan gelen anlık görüntüler + interpolasyon)              │
│  Renderer (PixiJS): arka plan, yem, yılanlar, sınır, isimler, efektler      │
│  OfflineMode: shared/sim'i tarayıcıda botlarla çalıştırır (dev + yedek)     │
└────────────────────────────────────────────────────────────────────────────┘
                      ▲  binary WebSocket (wss)  ▼
┌──────────────────────────── Sunucu (server) ───────────────────────────────┐
│  ConnectionManager → handshake, ping, rate limit                            │
│  RoomManager → açık/özel odalar, kapasite, "bigger rooms"                   │
│  Room → shared/sim World (30 Hz sabit adım) + BotController                 │
│  Snapshot/AOI → her oyuncuya görüş alanındaki varlıklar (delta)             │
│  Leaderboard (oda içi, 1 sn) + ScoreStore (SQLite, günlük/aylık/tüm)        │
│  HTTP: /api/top, /health, statik dosyalar (opsiyonel)                       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Temel ilke:** Oyun kuralları **tek bir yerde** (`packages/shared/src/sim`) yazılır. Sunucu bunu yetkili olarak çalıştırır; istemci çevrimdışı modda aynısını çalıştırır. Böylece Faz 1'de sunucu olmadan oynanabilir bir oyun olur, Faz 4'te aynı kod sunucuya taşınır.

---

## 6. Klasör Yapısı

```
slithergame.io v1.0/
├─ CURRENT_PLAN.md
├─ package.json                 # workspaces: packages/*
├─ tsconfig.base.json
├─ .eslintrc.cjs / .prettierrc
├─ packages/
│  ├─ shared/
│  │  └─ src/
│  │     ├─ config.ts           # tüm ayarlanabilir sabitler (§7 tablosu)
│  │     ├─ math.ts             # vec2, açı farkı, lerp, clamp, segment-nokta mesafesi
│  │     ├─ rng.ts              # tohumlanabilir rastgele (mulberry32)
│  │     ├─ colors.ts           # yılan ve yem paleti
│  │     ├─ protocol.ts         # mesaj tipleri, opcode'lar, encode/decode
│  │     ├─ nick.ts             # takma ad / oda adı doğrulama
│  │     └─ sim/
│  │        ├─ World.ts         # step(dt), varlık listeleri, olay kuyruğu
│  │        ├─ Snake.ts         # kafa, açı, gövde yolu, skor, boost
│  │        ├─ Body.ts          # sabit aralıklı yol noktaları, kırpma, örnekleme
│  │        ├─ Food.ts          # yem havuzu, spawn, mıknatıs
│  │        ├─ SpatialHash.ts   # çarpışma ve sorgu ızgarası
│  │        ├─ collisions.ts    # sınır, gövde, kafa-kafa kuralları
│  │        ├─ spawn.ts         # güvenli doğma noktası
│  │        └─ bots/BotBrain.ts # bot yapay zekâsı
│  ├─ client/
│  │  ├─ index.html
│  │  ├─ public/ (favicon, og-image, fontlar)
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ app/ (GameApp.ts, state machine: Menu → Connecting → Playing → Menu)
│  │     ├─ net/ (NetClient.ts, Interpolator.ts, PingMeter.ts)
│  │     ├─ offline/ (OfflineServer.ts — shared/sim + botlar, aynı arayüz)
│  │     ├─ input/ (Mouse.ts, Keyboard.ts, Touch.ts, Gamepad.ts, InputState.ts)
│  │     ├─ render/
│  │     │  ├─ Renderer.ts, Camera.ts
│  │     │  ├─ layers/ (Background.ts, Border.ts, FoodLayer.ts, SnakeLayer.ts, NameLayer.ts)
│  │     │  └─ textures.ts (glow daire, boncuk, göz dokuları — runtime üretilir)
│  │     ├─ ui/
│  │     │  ├─ menu.ts, tips.ts, colorPicker.ts
│  │     │  ├─ modals/ (settings.ts, topScores.ts, help.ts)
│  │     │  ├─ hud/ (leaderboard.ts, stats.ts, minimap.ts)
│  │     │  └─ styles/ (main.css, menu.css, hud.css, modal.css)
│  │     ├─ settings.ts (localStorage)
│  │     ├─ i18n/ (index.ts — t() fonksiyonu, tr.ts, en.ts — tüm arayüz metinleri)
│  │     └─ content/ (about.tr.html, about.en.html — sayfa altı metni, özgün yazılacak)
│  └─ server/
│     └─ src/
│        ├─ index.ts            # HTTP + WS sunucusu
│        ├─ ConnectionManager.ts
│        ├─ RoomManager.ts, Room.ts
│        ├─ Aoi.ts              # görüş alanı + delta takibi
│        ├─ BotController.ts
│        ├─ ScoreStore.ts       # SQLite
│        ├─ api.ts              # /api/top, /health
│        └─ security.ts         # rate limit, IP limit, origin kontrolü
└─ tools/
   ├─ loadtest/ (headless bot istemcileri)
   └─ docker/ (Dockerfile, nginx.conf)
```

---

## 7. Oyun Tasarımı — Kurallar ve Sayısal Değerler

> Tüm değerler `shared/src/config.ts` içinde **tek yerde** tutulur ve oynanarak ayarlanır. Aşağıdakiler başlangıç değerleridir. Birim: "u" (dünya birimi), süre saniye.

### 7.1 Arena
| Sabit | Değer | Not |
|-------|-------|-----|
| `ARENA_RADIUS` | 6000 u | Dairesel. Oda kapasitesine göre ölçeklenebilir: `R = 3000 + 120 * kapasite` (üst sınır 9000). |
| Sınır kalınlığı (görsel) | 40 u | Çarpışma çizgisi halkanın iç kenarı. |
| Ölüm koşulu | `|kafa| + r ≥ R` | |

### 7.2 Yılan modeli
- **Durum:** `id, name, colorIdx, x, y, angle, targetAngle, boosting, score, body: Point[], alive, isBot`.
- **Gövde (Body):** kafa ilerledikçe, son kaydedilen noktadan `SEGMENT_SPACING` (6 u) kadar uzaklaşıldığında yeni nokta eklenir (ara noktalar tam aralıkla enterpole edilir). Böylece nokta aralığı hızdan bağımsız ve **deterministik** olur (istemci aynı kafa konumlarından aynı gövdeyi kurar).
- **Uzunluk (u):** `length(score) = LEN_BASE + LEN_K * score^0.6` → başlangıç: `LEN_BASE = 120`, `LEN_K = 14`.
  - score 10 → ~176 u, score 1000 → ~1000 u, score 50 000 → ~9400 u.
  - Gövde yolu, toplam yay uzunluğu `length` olacak şekilde kuyruktan kırpılır (son nokta kısmi enterpolasyon).
- **Kalınlık (yarıçap r):** `r(score) = R_BASE + R_K * log2(1 + score/10)` → `R_BASE = 12`, `R_K = 2.4`, üst sınır yok (büyüme sınırsız; log olduğu için çok yavaşlar).
- **Boncuklar (sadece görsel):** gövde yolu üzerinde her `r * 0.85` u'da bir boncuk; boncuk yarıçapı `r * 0.42`.
- **Hız:** `BASE_SPEED = 230 u/s`, `BOOST_SPEED = 460 u/s`. Büyük yılan çok hafif yavaşlar: `speed *= 1 / (1 + r/400)`.
- **Dönüş:** hedef açıya doğru en fazla `TURN_RATE` ile döner: `TURN_RATE = 4.2 rad/s * sqrt(R_BASE / r)` (büyüdükçe dönüş yarıçapı büyür → küçükler çevik, büyükler çevreleyici).
- Kendi gövdesiyle çarpışma **yok**.

### 7.3 Hızlanma (Boost)
- Sol fare / Space / gamepad omuz tuşu / dokunmatikte ikinci parmak.
- `score > BOOST_MIN_SCORE (= 12)` iken çalışır; altına düşünce otomatik kapanır.
- Skor kaybı: `drain/s = 4 + score * 0.008`.
- Kaybedilen skorun `%40`'ı kuyruktan **yem** olarak düşer (yılanın renginde, küçük, seyrek: tek yem `clamp(skor × 0.002, 1.5, 6)` değerinde); kalan %60 kaybolur (sonsuz boost-yeniden toplama döngüsünü önler).
- Görsel: gövde parlaklığı artar; "Flashes: on" ise gövde boyunca akan ışık dalgası efekti.

### 7.4 Yem (Food / enerji)
| Tür | Değer | Yarıçap | Kaynak | Ömür |
|-----|-------|---------|--------|------|
| Ortam yemi | 1–3 | 4–8 u | Arena içine düzgün rastgele | sınırsız (yenilenir) |
| Boost yemi | 1.5–6 | 6–9 u | Boost eden yılanın kuyruğu | 30 sn sonra söner |
| Ölüm yemi | skor×0.8 / adet | r × 0.7–0.95 | Ölen yılanın gövdesi boyunca, her r×0.5'te bir | 90 sn sonra söner |

- Yoğunluk hedefi: `foodDensity = 1 yem / 30000 u²` → R=6000 için ≈ 3 800, R=5000 için ≈ 2 600 ortam yemi. (İlk değer 1/9000'di; orijinalle karşılaştırınca çok kalabalık bulunup düşürüldü — bkz. §0.2.)
- Ortam yemi yendikçe aynı sayıda yenisi, yendiği yerin 500–1600 u yakınında doğar (sabit yoğunluk, yem hiç tükenmez; nokta arena dışına düşerse rastgele bir yere).
- **Mıknatıs / yutma:** kafaya `MAGNET_RADIUS = r * 3 + 40` mesafedeki yem, kafaya doğru hızla çekilir (`600 u/s` + mesafeyle artan); `r + yemR` mesafesine girince yenir → `score += değer`.
- Renkler: palet (§9.5) içinden rastgele; ölüm yemi ölen yılanın rengi (+ hafif ton varyasyonu).
- İstemci tarafında her yem hafifçe nabız atar (boyut ±%10) ve çok yavaş salınır (sadece görsel).

### 7.5 Çarpışma kuralları
1. **Sınır:** `dist(kafa, merkez) + r ≥ ARENA_RADIUS` → ölüm.
2. **Gövde:** A'nın kafa dairesi (merkez kafa, yarıçap `rA * 0.9`), B'nin gövde yolu üzerindeki herhangi bir noktaya (`rB` yarıçaplı tüp) değerse → **A ölür**. B'nin kafasından itibaren ilk `headZoneK * rB` (= 1 × rB) u'luk kısım "kafa bölgesi" sayılır ve kural 3'e girer.
3. **Kafa-kafa:** A ve B'nin kafa bölgeleri temas ederse:
   - A odada **1. sıradaysa** → A yaşar, B ölür (B de 1. ise imkânsız).
   - `scoreA ≥ 2 * scoreB` ("çok daha büyük") → A yaşar, B ölür (ve tersi).
   - Aksi halde **ikisi de ölür**.
4. Aynı tick içinde birden fazla ölüm: önce tüm çarpışmalar tespit edilir, sonra ölümler uygulanır (sıra bağımsızlığı).
5. Uygulama: `SpatialHash` (hücre boyu 128 u). Her tick tüm canlı yılanların gövde noktaları (her 2. nokta yeterli) hücrelere eklenir; her kafa yalnızca çevre 3×3 (büyük yılanlarda 5×5) hücreleri sorgular. Mesafe hesabı nokta-segment uzaklığı ile.

### 7.6 Ölüm
- Gövde yolu boyunca, toplam değeri `score * 0.8` olan ölüm yemleri dizilir (her `r * 0.5` u'da bir, yarıçap `r * 0.7–0.95`, ±0.3r dağılım): üst üste binen parlak küreler yılanın şeklini çizer.
- Oyuncuya ölüm bildirimi → istemci kısa bir kararma (300 ms) ile menüye döner; son skor menüde küçük bir satırda gösterilebilir (orijinalde yok; opsiyonel iyileştirme, ayarla kapatılabilir).
- Skor ≥ 50 ise kalıcı skor tablosuna yazılır (§12.6).
- Öldüren oyuncu kaydedilir (ileride "öldürme" istatistiği için; MVP'de gösterilmez).

### 7.7 Doğma (Spawn)
- Arena merkezinden `0.75 * R` içinde rastgele nokta; en yakın başka yılan gövdesine ≥ 600 u ve sınıra ≥ 800 u olacak şekilde en fazla 30 deneme; olmazsa en iyi aday.
- Başlangıç açısı: merkeze doğru ± rastgele 45°.
- Başlangıç skoru: **10**. Gövde, kafanın arkasına düz bir çizgi olarak oluşturulur.
- Doğma koruması yok (orijinalle aynı); `SPAWN_PROTECTION_MS = 0` sabiti ile açılabilir.

### 7.8 Skor ve sıralama
- Skor = toplanan enerji (ondalık tutulur, ekranda tam sayı).
- Oda sıralaması skora göre; eşitlikte önce gelen önde.
- Oda skor tablosu her **1 sn**'de bir gönderilir (ilk 10 + her oyuncuya kendi sırası ve toplam oyuncu sayısı).

### 7.9 Botlar
- Amaç: oda boşken bile canlı görünmesi. `BOT_TARGET_POPULATION = 20` (gerçek oyuncu geldikçe bot sayısı azalır, oda dolarsa bot kalmaz).
- Bot adları: özgün bir isim listesinden (örn. "Neon", "Pixel", "Orbit", …) + bazen `Guest###`.
- **BotBrain** (her 100–200 ms karar, tick'te açıya doğru döner):
  1. **Kaçınma:** önündeki koni içinde (mesafe `r*12`) gövde/sınır varsa, en güvenli yöne dön (8 yönlü ışın testi).
  2. **Yem arama:** görüş yarıçapı içindeki yem kümelerine ağırlıklı yönelim (ölüm yemi öncelikli).
  3. **Saldırı (büyük botlar):** yakındaki küçük yılanın önünü kesmek / etrafını sarmak için hedefin önüne doğru boost.
  4. **Boost:** kaçarken veya yakın yüksek değerli yem varken, skor yeterliyse.
  5. Zorluk karışımı: botların %30'u "agresif", %50'si "normal", %20'si "pasif". Rastgele hata payı (açı gürültüsü).
- Bot öldüğünde 2–6 sn sonra yeniden doğar.

---

## 8. Simülasyon Ayrıntıları (`shared/src/sim`)

- **Sabit zaman adımı:** `TICK_RATE = 30 Hz` (`dt = 1/30`). Sunucu `setInterval` yerine sapmayı telafi eden döngü (`performance.now()` biriktirici) kullanır.
- **Tick sırası:**
  1. Girdileri uygula (her yılan için son alınan `targetAngle`, `boost`).
  2. Açıyı `TURN_RATE * dt` sınırıyla döndür.
  3. Boost drenajı + boost yemi düşürme.
  4. Kafayı ilerlet, gövde noktalarını ekle, uzunluğa göre kırp.
  5. Yem mıknatısı + yeme.
  6. SpatialHash'i yeniden kur, çarpışmaları tespit et.
  7. Ölümleri uygula, ölüm yemlerini oluştur.
  8. Ortam yemini tamamla, süresi dolan yemleri sil.
  9. Bot kararları (zamanlayıcıya göre).
  10. Olayları (`spawned`, `died`, `foodAdded`, `foodRemoved`, `ate`) kuyruğa yaz → ağ katmanı tüketir.
- **Determinizm:** RNG tohumlanabilir; testlerde aynı tohum aynı sonucu verir.
- **Veri yapıları:** Yem için sabit kapasiteli havuz + serbest liste (GC baskısını önlemek için). Gövde noktaları için halka tampon (`Float32Array`) — kafaya ekle, kuyruktan kırp O(1).
- **World API:** `addSnake(opts)`, `removeSnake(id)`, `setInput(id, angle, boost)`, `step()`, `drainEvents()`, `queryRect(x, y, w, h)`, `getLeaderboard(n)`.

---

## 9. İstemci Render (`client/src/render`)

### 9.1 Genel
- PixiJS `Application`, tam pencere, `resolution = min(devicePixelRatio, Graphics=high ? 2 : 1.5)` (low → 1).
- Pencere boyutu değişince yeniden boyutlandır.
- Render döngüsü `requestAnimationFrame`; "Framerate" ayarı: high = sınırsız (ekran yenileme hızı), normal = 60, low = 30 FPS sınırı.
- Katman sırası (alttan üste): Arka plan → Arena dışı karartma → Yem → Yılanlar (küçükten büyüğe veya ölüm sırasına göre; kendi yılanın en üstte) → İsimler → Sınır halkası → (HUD ayrı HTML katmanında).

### 9.2 Kamera
- Kendi yılanın kafasını yumuşak takip eder (`lerp` katsayısı ~0.15/frame, dt'ye göre normalize).
- **Zoom:** yılan büyüdükçe uzaklaşır: `zoom = clamp(1.0 * (14 / r)^0.55, 0.35, 1.0)` × ekran ölçeği (`min(w,h)/900`). Zoom değişimi yumuşak.
- **Doğma animasyonu:** zoom 0.3'ten hedefe ~900 ms'de `easeOutCubic`.
- Ölümde kamera son konumda kalır, kararma ile menüye geçilir.
- Görüş dikdörtgeni (+%20 kenar payı) dışındaki nesneler çizilmez (culling).

### 9.3 Arka plan
- Düz koyu lacivert (`#0a1633` civarı), merkezde hafif açık radyal gradyan / vinyet.
- **Altıgen ızgara:** düz-üst (flat-top) hex, kenar uzunluğu ~180 u; çizgiler **noktalı** (küçük açık mavi noktalar, `#7fa7e0` %35 opaklık).
- **İnce nokta dokusu:** çok küçük, düşük opaklıklı noktaların tekrarlanan dokusu.
- Uygulama: bir hex hücresini ve noktaları içeren **tekrarlanabilir doku** (TilingSprite) runtime'da üretilir; kamera ile kaydırılır ve zoom'a göre ölçeklenir. Zoom < 0.5'te ızgara opaklığı azalır.
- Graphics=low → nokta dokusu kapalı, ızgara düz ince çizgi.

### 9.4 Arena sınırı
- Kalın (40 u) açık mavi (`#6fb6ff`) halka + dış parlama (blur'lu ikinci halka).
- Halkanın dışındaki alan %60 siyah ile karartılır (büyük bir çokgen maskesi veya tam ekran shader).
- Uzun halka, görüş alanına giren kısmı için çokgen segmentleri olarak çizilir (performans).

### 9.5 Renk paleti (özgün, 16 renk)
Sarı `#ffe14d`, camgöbeği `#4de8ff`, lavanta `#b9a8ff`, periwinkle `#8fa8ff`, pembe `#ff7ab8`, mercan `#ff7a6b`, turuncu `#ffa94d`, limon yeşili `#b4ff4d`, yeşil `#4dff88`, turkuaz `#3fe0c5`, mavi `#4d8dff`, mor `#c56bff`, beyaz `#f2f6ff`, açık gri `#c9d3e6`, kırmızı `#ff4d5e`, altın `#ffcc33`.
Yem paleti: bunların açık tonları + beyaz.

### 9.6 Yem çizimi
- Runtime'da üretilen **glow daire dokusu** (merkez beyaz-renkli, dışa doğru yumuşak sönen hale). Her yem bir `Sprite` (tint = renk, ölçek = yarıçap).
- PixiJS `ParticleContainer` (v8: `Particle`) ile binlerce yem tek draw call'da.
- Animasyon: nabız (sin(time + id)), yenince kafaya doğru kayarak küçülüp kaybolma (100 ms).
- Graphics=low → hale yok, düz daire.

### 9.7 Yılan çizimi (en önemli görsel)
Gövde yolu (interpolasyonlu noktalar) üzerinde sabit aralıklı örnek noktalar alınır; her örnek için üst üste sprite katmanları:
1. **Kontur/glow katmanı:** yarıçap `r * 1.12`, yılan rengi, %55 opaklık, yumuşak kenarlı daire dokusu → tüpün dışında ince parlak çizgi gibi görünür.
2. **Tüp katmanı:** yarıçap `r`, renk `#05070d` (neredeyse siyah), opak. Örnek aralığı `r * 0.35` → pürüzsüz tüp.
3. **Boncuk katmanı:** her `r * 0.85`'te bir, yarıçap `r * 0.42`, yılan rengi; boncuğun ortası hafif açık (iç parlama dokusu). Kuyruğa doğru son %15'te boncuklar hafif küçülür ve solar.
4. **Kafa:** son boncuk biraz büyük; üzerine **iki göz** (beyaz değil, koyu nokta + çok küçük parlak yansıma), göz bebekleri hareket yönüne/hedef açıya bakar.
- Katmanlar tüm yılan için ayrı konteynerlerde tutulur ki kontur tüm tüpün altında kalsın (yılanlar kendi üzerinden geçerken doğru görünsün).
- **Boost:** kontur opaklığı %90'a çıkar, boncuklar parlar; "Flashes: on" ise baştan kuyruğa doğru akan beyazımsı ışık dalgası (boncuk parlaklığı `sin(i*0.4 - t*12)`).
- **Ölüm efekti:** gövde 250 ms içinde boncuklara ayrılıp ölüm yemlerine dönüşür (sunucu yemleri zaten gönderir; istemci gövdeyi soldurur).
- Sprite havuzu: her frame sprite oluşturmak yerine havuzdan al/geri ver.
- Çok uzun yılanlarda (>800 örnek) ve uzak zoom'da örnek aralığı büyütülür (LOD).

### 9.8 İsimler
- Yılanın kafasının altında, `r + 18` u uzakta, beyaz %75 opak küçük yazı (`BitmapText` — performans için).
- Kendi isminin gösterimi orijinaldeki gibi açık; "Nicknames: hidden" → tüm isimler gizli.
- Uzun isimler 16 karakterde kesilir (`…`).

### 9.9 Grafik kalite seviyeleri
| Özellik | low | normal | high |
|---------|-----|--------|------|
| resolution | 1 | min(DPR,1.5) | min(DPR,2) |
| Yem hale | yok | var | var + daha büyük |
| Yılan kontur glow | düz | yumuşak | yumuşak + blur filtre |
| Arka plan nokta dokusu | yok | var | var |
| Sınır parlaması | yok | var | var + blur |
| Gövde örnek aralığı | r*0.5 | r*0.35 | r*0.3 |

---

## 10. UI / UX (`client/src/ui`)

### 10.1 Uygulama durum makinesi
`Boot → Menu → Connecting → Playing → (Died) → Menu`
- `Menu`: canvas arkada bulanık/boş, menü katmanı görünür. (İsteğe bağlı: arka planda yavaşça kayan hex ızgara.)
- `Connecting`: spinner; 8 sn'de bağlanamazsa "Sunucuya bağlanılamadı — Çevrimdışı oyna?" mesajı (offline modu başlatır).
- `Playing`: HUD görünür, menü gizli, imleç `crosshair` değil normal ok.
- `Died`: 300 ms karartma → `Menu`.

### 10.2 Ana menü
- Logo: **"Yılan"** (turkuaz) + **".io"** (sarı, "." nokta parlayan bir yem gibi), SVG veya web fontu ile, `text-shadow`/SVG filter ile neon glow, yuvarlak hatlı kalın font (ör. **"Baloo 2"** veya **"Fredoka"** — Google Fonts, açık lisanslı).
- Genel metin fontu: el yazısına yakın yuvarlak bir font (ör. **"Comic Neue"** veya **"Itim"**) — orijinaldeki samimi hava için.
- **Font şartı:** seçilen fontlar Türkçe karakterleri (ı, İ, ş, Ş, ğ, Ğ, ü, ö, ç) desteklemeli (`latin-ext` alt kümesi); desteklemeyen font elenir. Fontlar yerel olarak (`public/fonts`) paketlenir ki çevrimdışı/LAN'da da çalışsın.
- `Nickname` input: koyu mavi zemin, ince açık mavi çerçeve, `maxlength=16` (+ `@oda` için toplam 40), son kullanılan ad `localStorage`'dan doldurulur.
- `Play` düğmesi: koyu zemin, sarı çerçeve ve sarı yazı; hover'da hafif parlama.
- Enter = Play. Gamepad Start = Play.
- **İpucu satırı:** 5 sn'de bir yumuşak geçişle (fade) değişen özgün ipuçları listesi (§2.1).
- Sağ üst ikonlar: SVG ikonlar (özgün çizim): yeşil soru işareti, mavi dişli, sarı kupa. Hover'da büyüme (%8) ve parlama.
- Sağ alt **renk seçici**: seçili renkte kafa önizlemesi (canvas veya SVG, iki göz). Tıklayınca 16 renklik palet açılır (4×4 ızgara popup); seçim `localStorage`'a kaydedilir. Fare tekerleği ile de renk değiştirilebilir.
- Alt bilgi: `© 2026 Yılan.io • Hakkında • Gizlilik • v1.0.0` (İngilizce'de About / Privacy). "About" → sayfa altındaki hakkında bölümüne kaydırır; "Privacy" → `/privacy` (özgün, kısa gizlilik metni).
- Sayfa altı içerik (menüdeyken kaydırılabilir): Oyun hakkında, Kontroller, Gamepad, Odalar, Ayarlar, SSS — **tamamen kendi cümlelerimizle** yazılacak. Sağ altta "yukarı dön" düğmesi (kaydırınca görünür).
- Oyun sırasında sayfa kaydırma kilitlenir (`overflow: hidden`).

### 10.3 Modallar (ortak bileşen)
- Ortada, ekranın ~%70 genişliği (max 700px), koyu lacivert (`#04122b` %95), 1px açık mavi çerçeve, sağ üstte ⊗ kapat; Esc ve dışarı tıklama ile kapanır. Arka plan %50 karartılır.
- **Ayarlar:** §2.2 tablosu + en alta **Dil / Language** satırı (§10.6). Değere tıklayınca sıradaki seçenek; anında uygulanır ve `localStorage`'a yazılır.
- **Top scores:** Daily / Monthly / All-Time sekmeleri (aktif sekme beyaz, diğerleri soluk mavi). İçerik `GET /api/top?period=...` ile gelir; yüklenirken mini spinner. Satır: `sıra. ad — skor` + varsa sıra değişimi üst simge (`↑2` yerine orijinal tarzı `⁺²`/`⁻¹`). Çevrimdışıyken "Skor tablosu şu an kullanılamıyor".
- **Yardım (?):** kısa kontroller özeti + "Daha fazla bilgi" → sayfa altına kaydır.

### 10.4 HUD (oyun içi, HTML overlay — canvas üstünde, `pointer-events: none`)
- **Skor tablosu (sağ üst):** genişlik ~230px, 1px kesikli açık mavi çerçeve, yarı saydam koyu zemin. 10 satır + gerekirse kendi satırı (beyaz/kalın). Sağa hizalı skor. Uzun ad `…`. Ayardan gizlenebilir.
- **İstatistik (sol alt):** 4 satır küçük yazı:
  - `FPS: <anlık>/<hedef>` 
  - `Ping: <ort>~<sapma>` (ms)
  - `Score: <tam sayı>`
  - `Rank: <sıra> of <toplam>`
- **Mini harita (sağ alt):** ~150px daire canvas (ayrı küçük 2D canvas, 5 Hz güncelleme). Açık mavi halka = arena sınırı; beyaz nokta = ben; soluk noktalar = en büyük 5 yılanın konumu (sunucu 1–2 sn'de bir gönderir). Ayardan gizlenebilir.
- Ölçekleme: tüm HUD `min(vw, vh)` tabanlı ölçeklenir; mobilde biraz küçülür.

### 10.5 Erişilebilirlik / küçük detaylar
- Klavye ile tüm modallar gezilebilir (Tab, Esc).
- Sekme arka plana alınınca (`visibilitychange`) render durur, bağlantı korunur; çok uzun süre (>60 sn) arka planda kalırsa sunucu oyuncuyu düşürebilir.
- Pencere başlığı: TR `Yılan.io | Ücretsiz çevrim içi yılan oyunu`, EN `Yılan.io | Free online snake io game`.
- Favicon + Open Graph görseli (özgün).

### 10.6 Çoklu dil (Türkçe + İngilizce)
- Tüm arayüz metinleri `client/src/i18n/tr.ts` ve `en.ts` içinde anahtar → metin sözlüğü olarak tutulur; kodda doğrudan metin yazılmaz, `t('menu.play')` kullanılır.
- Her iki sözlük aynı anahtarları içermeli: `en.ts` tipi `tr.ts`'ten türetilir (`typeof tr`), eksik anahtar derleme hatası verir.
- İlk açılışta dil: `localStorage` → yoksa `navigator.language` "tr" ile başlıyorsa Türkçe, aksi halde İngilizce.
- Ayarlar modalına satır: `Dil: Türkçe` / `Language: English` (tıklayınca değişir, sayfa yenilenmeden tüm metinler güncellenir).
- `<html lang>` ve pencere başlığı dile göre güncellenir.
- Çevrilecek alanlar: menü (Play, Takma ad yer tutucusu, ipuçları), modallar (Ayarlar etiketleri ve değerleri, En Yüksek Skorlar ve sekmeleri, Yardım), HUD etiketleri (FPS, Ping, Skor, Sıra "19 / 22"), hata/bağlantı mesajları, sayfa altı hakkında/SSS içeriği (ayrı HTML dosyaları), gizlilik metni.
- Örnek karşılıklar: Play → **Oyna**, Nickname → **Takma ad**, Settings → **Ayarlar**, Top scores → **En yüksek skorlar**, Daily/Monthly/All-Time → **Günlük / Aylık / Tüm zamanlar**, Leaderboard → **Skor tablosu**, Nicknames → **İsimler**, Minimap → **Mini harita**, visible/hidden → **görünür / gizli**, Join bigger rooms → **Büyük odalara katıl** (otomatik/evet/hayır), Flashes → **Işık efektleri** (kapalı/açık), Graphics → **Grafik** (düşük/normal/yüksek), Framerate → **Kare hızı**, Controls → **Kontroller** (fare/joystick/ok), Score → **Skor**, Rank → **Sıra**.
- Sunucu mesajları metin değil **kod** gönderir (ör. `ERROR` kodu 3 = oda dolu); metin istemcide çevrilir.
- Bot adları dilden bağımsız, özgün liste.

---

## 11. Kontroller (`client/src/input`)

Tüm girdiler tek bir `InputState { targetAngle: number, boost: boolean }` üretir.

| Cihaz | Yön | Hızlanma | Diğer |
|-------|-----|----------|-------|
| Fare | Ekran merkezinden (kafa) imlece açı | Sol tık basılı | Sağ tık menüsü engellenir |
| Klavye | (ek) ←/→ veya A/D: açıyı sürekli döndürür | Space / ↑ / W basılı | Esc: menüye dön (onaylı değil, direkt ölüm sayılmaz → sunucudan ayrıl) |
| Dokunmatik — joystick modu | İlk dokunuşun olduğu yer merkez; parmağın merkeze göre yönü | Ekranın herhangi bir yerinde ikinci parmak basılı | Yarı saydam joystick halkası çizilir |
| Dokunmatik — arrow modu | Ekran merkezinden parmağa açı (fareyle aynı mantık) | İkinci parmak | Parmak yanında küçük ok göstergesi |
| Gamepad | Sol veya sağ çubuk (ölü bölge 0.25) | Omuz tuşları (LB/RB/LT/RT) | Start = Play, Back/Select = menü |

- Girdi gönderimi: açı 1/65536 hassasiyetle `uint16`, değişim > ~0.5° veya boost değişirse ve en fazla 30 Hz.
- Dokunmatik cihaz tespiti: `matchMedia('(pointer: coarse)')` → Ayarlarda "Controls" satırı görünür; varsayılan joystick.
- Mobilde `touch-action: none`, çift dokunma zoom'u ve uzun basma menüsü engellenir; `viewport user-scalable=no`.

---

## 12. Ağ ve Sunucu

### 12.1 Taşıma
- WebSocket, `binaryType = 'arraybuffer'`, tüm mesajlar **binary** (`DataView` ile elle encode/decode, `shared/src/protocol.ts`).
- URL: `wss://<host>/ws?v=<protokolSürümü>`. Sürüm uyuşmazsa sunucu "güncelleme gerekli" mesajıyla kapatır → istemci sayfayı yenile önerir.

### 12.2 Mesajlar

**İstemci → Sunucu**
| Opcode | Ad | Alanlar |
|--------|----|---------|
| 0x01 | `JOIN` | nick (utf8, ≤16 karakter), room (utf8, ≤20, boş = açık oda), colorIdx (u8), joinBigger (u8: 0 auto,1 yes,2 no), viewW/viewH (u16) |
| 0x02 | `INPUT` | angle (u16), flags (u8: bit0 boost) |
| 0x03 | `PING` | clientTime (u32) |
| 0x04 | `VIEW` | viewW/viewH (u16) — pencere boyutu değişince |
| 0x05 | `LEAVE` | — (menüye dönüş) |

**Sunucu → İstemci**
| Opcode | Ad | Alanlar |
|--------|----|---------|
| 0x81 | `WELCOME` | myId (u16), arenaRadius (u16), tickRate (u8), roomName, serverTime |
| 0x82 | `SNAPSHOT` | tick (u32), [güncellenen yılanlar], [giren yılanlar], [çıkan yılan id'leri] |
| 0x83 | `FOOD_ADD` | [id u32, x i16·q, y i16·q, değer u8, renk u8] |
| 0x84 | `FOOD_REMOVE` | [id u32, yiyenYılanId u16 (animasyon için, 0 = süre doldu)] |
| 0x85 | `LEADERBOARD` | top10 [id, ad, skor], myRank (u16), total (u16) |
| 0x86 | `MINIMAP` | [x u8, y u8, boyut u8] (en büyük 5 yılan, arena normalize) |
| 0x87 | `DIED` | sebep (u8: sınır/gövde/kafa), killerId, finalScore (u32) |
| 0x88 | `PONG` | clientTime (u32) |
| 0x89 | `ERROR` | kod (u8) + mesaj (ör. oda dolu, sürüm eski, rate limit) |

- **Yılan "giriş" kaydı** (görüş alanına ilk girişte): id, ad, renk, skor, kafa x/y, açı, gövde noktaları (kafaya göre **göreli** i8/i16 delta dizisi, nicemlenmiş).
- **Yılan "güncelleme" kaydı** (her snapshot): id (u16), kafa x/y (i16, 1 birim = 0.25 u … veya göreli delta i8), açı (u8), skor (u24 veya delta), flags (boost, ölü).
- İstemci gövdeyi, sunucuyla **aynı `Body` algoritmasını** (shared) kafa konumlarına uygulayarak yeniden kurar → gövde noktaları her tick gönderilmez (büyük bant genişliği tasarrufu). Her 5 sn'de bir veya sapma tespitinde gövde tam olarak yeniden gönderilir (düzeltme).

### 12.3 Görüş alanı (AOI) ve delta
- Her oyuncu için görüş dikdörtgeni = `viewW/viewH / zoom` × 1.3 kenar payı (zoom sunucuda da skordan hesaplanır, istemci hilesi engellenir).
- Sunucu her oyuncu için "bilinen yılanlar" ve "bilinen yemler" kümelerini tutar; sadece farkları gönderir.
- Yem sorguları `SpatialHash` ile; görüş alanına giren yeni yemler `FOOD_ADD`, çıkanlar istemcide sessizce silinir (istemci kendi culling'ini yapar; ayrı mesaj gerekmez — bilinen kümeden çıkarılır).
- Snapshot gönderim hızı: **30 Hz** (her tick). Bant genişliği yüksek görünürse 15 Hz'e düşürülüp interpolasyon buna göre ayarlanır.

### 12.4 İstemci tarafı yumuşatma
- **Interpolasyon:** istemci, sunucu zamanının `INTERP_DELAY = 100 ms` gerisini çizer; iki snapshot arasında kafa konumu/açısı lineer (açı için en kısa yol) enterpole edilir.
- **Kendi yılanın:** gecikmeyi azaltmak için kafa açısı yerel girdiye göre anında hafifçe döndürülür (görsel tahmin), konum sunucudan gelir; Faz 5'te tam istemci tahmini + uzlaştırma (reconciliation) değerlendirilecek.
- Paket kaybı/gecikme sıçramasında ekstrapolasyon en fazla 200 ms.
- Ping: 2 sn'de bir `PING`; son 10 ölçümün ortalaması ve standart sapması `Ping: ort~sapma` olarak gösterilir.

### 12.5 Sunucu: Odalar
- **RoomManager:**
  - Açık odalar otomatik açılır; kapasite `ROOM_CAPACITY = 50` (bot hariç gerçek oyuncu).
  - Katılımda: "Join bigger rooms" = auto/yes ise en kalabalık **dolu olmayan** oda; no ise en az kalabalık oda. Hiç uygun oda yoksa yeni oda.
  - Odada gerçek oyuncu kalmadığında 5 dk sonra oda kapatılır (en az 1 açık oda hep yaşar).
- **Özel odalar (`Ad@Oda`):**
  - Oda adı: `[A-Za-z0-9_-]{1,20}`, büyük/küçük harf duyarsız.
  - Oda varsa ve dolu değilse → katıl.
  - Yoksa: "bekleme salonu" açılır; `PRIVATE_MIN_PLAYERS = 8` (ayarlanabilir, geliştirmede 1) kişi `PRIVATE_WAIT_MS = 20 000` içinde aynı adı girerse oda kurulur ve kapasitesi `max(8, bekleyen sayısı * 1.5)` olur; süre dolarsa bekleyenler ortak bir açık odaya yerleştirilir.
  - Özel odalarda bot yok (opsiyon: oda sahibi yok, bu yüzden sabit kural).
- Her oda kendi `World`'ünü ve tick döngüsünü çalıştırır (tek süreçte çok oda; gerekirse ileride worker thread başına oda grubu).

### 12.6 Sunucu: Kalıcı skor tablosu (SQLite)
```sql
CREATE TABLE scores (
  id         INTEGER PRIMARY KEY,
  nick       TEXT    NOT NULL,
  score      INTEGER NOT NULL,
  room       TEXT,
  created_at INTEGER NOT NULL      -- unix ms (UTC)
);
CREATE INDEX idx_scores_time  ON scores(created_at);
CREATE INDEX idx_scores_score ON scores(score DESC);

CREATE TABLE rank_snapshots (       -- sıra değişimi göstergesi için
  period     TEXT    NOT NULL,      -- daily | monthly | alltime
  nick       TEXT    NOT NULL,
  rank       INTEGER NOT NULL,
  taken_at   INTEGER NOT NULL,
  PRIMARY KEY (period, nick)
);
```
- Ölümde `finalScore ≥ 50` ise kayıt eklenir (botlar **hariç**).
- Sorgu: periyot başlangıcından (UTC gün başı / ay başı / 0) sonraki kayıtlarda **takma ad başına en yüksek skor**, ilk 50.
- Sıra değişimi: her saat başı mevcut sıralar `rank_snapshots`'a yazılır; API yanıtında `delta = eskiSıra - yeniSıra` döner (0 ise gösterilmez).
- Sonuçlar 30 sn önbelleklenir.
- `GET /api/top?period=daily|monthly|alltime` → `[{ rank, nick, score, delta }]`.
- Eski kayıt temizliği: 400 günden eski ve tüm zamanlar ilk 1000'inde olmayan kayıtlar haftalık silinir.

### 12.7 Güvenlik ve hile önleme
- Sunucu **yetkili**: istemci yalnızca açı + boost gönderir; konum, skor, çarpışma tamamen sunucuda.
- `INPUT` en fazla 60/sn; aşılırsa yok sayılır, sürekli aşımda bağlantı kapatılır.
- Mesaj boyutu sınırı (ör. 256 bayt), bilinmeyen opcode → bağlantı kapat.
- IP başına en fazla 4 eşzamanlı bağlantı; saniyede bağlantı açma sınırı.
- `Origin` başlığı kontrolü (izin listesi).
- Takma ad temizliği: kontrol karakterleri, sıfır genişlikli karakterler, aşırı birleşik (zalgo) karakterler temizlenir; 16 görünür karakter sınırı; boşsa `Guest###`. (Opsiyonel küfür filtresi listesi.)
- Ping zaman aşımı: 15 sn yanıt yoksa bağlantı kapatılır.
- Sunucu logları: bağlantı sayısı, oda sayısı, tick süresi (ms), bant genişliği/sn.

---

## 13. Ayarlar ve Kalıcılık (istemci `localStorage`)

| Anahtar | İçerik |
|---------|--------|
| `yilan.nick` | son takma ad (oda kısmı dahil) |
| `yilan.color` | renk indeksi |
| `yilan.settings` | `{ leaderboard, nicknames, minimap, joinBigger, flashes, graphics, framerate, controls }` |
| `yilan.lang` | `tr` veya `en` |
| `yilan.lastScore` | son skor (opsiyonel gösterim) |

- Tüm erişimler `try/catch` içinde (gizli mod vb.); yoksa varsayılanlar.

---

## 14. Ses
Orijinal oyunda ses gözlenmedi. Kapsam dışı; ileride opsiyonel olarak yem yeme "pop", boost "vınlama", ölüm sesi + ayarlara "Sound: on/off" eklenebilir.

---

## 15. Performans Hedefleri

| Metrik | Hedef |
|--------|-------|
| İstemci FPS (orta seviye dizüstü, 50 yılan + görüşte ~1500 yem) | ≥ 60 |
| İstemci FPS (orta seviye telefon, Graphics=normal) | ≥ 45 |
| Sunucu tick süresi (50 oyuncu + 20 bot, 12 500 yem) | < 8 ms (bütçe 33 ms) |
| Oyuncu başına indirme | < 12 KB/s ortalama |
| Oyuncu başına yükleme | < 1 KB/s |
| İlk yükleme (gzip) | JS < 350 KB, ilk etkileşim < 2 sn |

Teknikler: sprite havuzları, `ParticleContainer`, typed array'ler, GC'siz döngüler, culling, LOD, binary protokol, delta + AOI, yem sorguları için spatial hash, sunucuda nesne yeniden kullanımı.

---

## 16. Test Stratejisi

- **Birim (Vitest, `shared`)**:
  - `Body`: sabit aralıklı nokta ekleme, uzunluğa göre kırpma, uzunluk değişiminde doğru davranış.
  - Çarpışma: sınır, gövde, kafa-kafa (1. sıra istisnası, 2× büyüklük istisnası, ikisi de ölür).
  - Yem: mıknatıs, yeme, yoğunluk koruma, ömür.
  - Boost: drenaj, minimum skor, yem düşürme oranı.
  - Protokol: her mesajın encode → decode simetrisi.
  - Takma ad/oda adı doğrulama.
- **Simülasyon testi:** aynı tohumla 10 000 tick → aynı durum özeti (determinizm).
- **Entegrasyon:** sunucuyu test portunda başlat, 2 headless istemci bağla, katıl/girdi/ölüm akışı.
- **Yük testi (`tools/loadtest`)**: 100–200 headless bot istemcisi ile tick süresi ve bant genişliği ölçümü.
- **Manuel test listesi:** Chrome, Firefox, Safari (macOS/iOS), Edge, Android Chrome; dokunmatik iki mod; gamepad (Xbox/PS); pencere yeniden boyutlandırma; yüksek DPR ekran; sekme arka plana alma; ağ kesilmesi.

---

## 17. Çalıştırma ve (ileride) Yayına Alma

Karar: **şimdilik yerel**. Öncelik, oyunun kendi bilgisayarda ve aynı Wi-Fi/LAN'daki cihazlardan (telefon, başka PC) oynanabilmesi.

### 17.1 Geliştirme
- `npm run dev` → Vite istemcisi (ör. `http://localhost:5173`) + Node sunucusu (ör. `:8080`) birlikte açılır; Vite, `/ws` ve `/api` isteklerini sunucuya proxy'ler.
- Faz 1–3 boyunca sunucu gerekmez: `npm run dev:client` ile çevrimdışı (botlu) mod.

### 17.2 Yerel üretim / LAN
- `npm run build && npm start` → Node sunucusu hem derlenmiş istemciyi (`client/dist`) hem `/ws` ve `/api`'yi **tek port** üzerinden sunar (ör. `http://<bilgisayar-IP>:8080`).
- Sunucu `0.0.0.0` adresini dinler; başlangıçta konsola LAN adresini yazdırır ("Telefondan şuraya gir: http://192.168.x.x:8080").
- İstemci WebSocket adresini sayfanın kendi adresinden türetir (`ws://` veya `wss://` + `location.host`) → ayrı yapılandırma gerekmez.
- Windows Güvenlik Duvarı'nda port izni gerekebilir; README'de nasıl yapılacağı anlatılır.
- SQLite dosyası varsayılan olarak `./data/yilan.db`.

### 17.3 İleride internete yayın (şimdilik yapılmayacak, hazırlık yapılacak)
- Docker: çok aşamalı `Dockerfile` (build → slim runtime), SQLite dosyası volume'da; `docker compose up` ile tek komutta çalışır.
- Yayına alınırken: Nginx (TLS, Let's Encrypt) → Node; `ALLOWED_ORIGINS` ayarlanır.
- Ortam değişkenleri: `PORT`, `HOST`, `ALLOWED_ORIGINS`, `DB_PATH`, `ROOM_CAPACITY`, `BOT_TARGET_POPULATION`, `PRIVATE_MIN_PLAYERS`.
- `/health` uç noktası (oda/oyuncu sayısı, tick ortalaması).
- Alan adı notu: "yılan.io" Türkçe `ı` içerir (IDN/punycode olarak kaydedilir); ASCII karşılığı `yilan.io` ile birlikte kontrol edilmeli.

---

## 18. Portal Sayfası — kapsam dışı

Karar: **sadece oyun**. slithergame.io tarzı portal (reklam alanları, diğer oyunlar, yorumlar, SEO makalesi) yapılmayacak. Oyun, ileride istenirse bir başka sayfaya `iframe` ile gömülebilecek şekilde tam pencere ve kendi kendine yeterli tasarlanır.

---

## 19. Yol Haritası — Ayrıntılı Görev Listesi

### Faz 0 — Proje iskeleti ✅
- [x] Kök `package.json` (workspaces), `tsconfig.base.json`, Prettier, `.gitignore`, `.editorconfig`, `.gitattributes`. (ESLint Faz 8'e ertelendi — §0.2.)
- [x] `git init` (dal: `main`).
- [ ] İlk commit — kullanıcı onayı bekleniyor.
- [x] `packages/shared` (TS kaynak olarak dışa aktarılır), `packages/client` (Vite + PixiJS), `packages/server` (Node + tsx; `ws` Faz 4'te eklenecek).
- [x] Kök scriptler: `dev`, `dev:client`, `dev:server`, `build`, `start`, `test`, `typecheck`, `format`, `bench`.
- [x] PixiJS sahnesi tam ekran açılıyor, sunucu `/health` cevap veriyor.

### Faz 1 — Çekirdek simülasyon + çevrimdışı oynanabilir sürüm ✅
- [x] `config.ts` (§7 sabitleri + formüller), `math.ts`, `rng.ts`, `colors.ts`, `nick.ts`.
- [x] `Body` (halka tampon, sabit aralık, kırpma, `pointAt`) + testleri.
- [x] `Snake` (dönüş, hız, boost drenajı, uzunluk/kalınlık formülleri).
- [x] `FoodStore` havuzu + kendi ızgarası, ortam yemi doğurma, mıknatıs, yeme, ömür.
- [x] `BodyGrid` (uzamsal ızgara) + çarpışmalar `World` içinde (sınır, gövde, kafa-kafa) + testleri.
- [x] Ölüm → ölüm yemleri; spawn algoritması (`spawn.ts`).
- [x] `World.step()` tick sırası (§8), olay kuyruğu.
- [x] `BotBrain` v1 (ışın taramasıyla kaçınma, yem arama, küçükleri kesme) + `BotController` (nüfusu hedefte tutma, yeniden doğma).
- [x] İstemci `OfflineGame`: sim'i tarayıcıda 30 Hz çalıştırır, çizim ekran yenileme hızında enterpole eder.
- [x] Render (Faz 1 için planlanandan ileri: kontur + koyu tüp + boncuklar + gözler, hex ızgara, yem haleleri, sınır) + fare yönü + sol tık/Space boost.
- [x] Birim testleri: 26 test (matematik, takma ad, gövde, hareket, yem, boost, tüm çarpışma kuralları, ölüm yemi, botlar, determinizm).
- [x] **Kabul:** Tarayıcıda botlara karşı oynanabiliyor; büyüme, boost, ölüm, yem bırakma çalışıyor (tarayıcıda ve testlerle doğrulandı).

### Faz 2 — Görsel kimlik
- [ ] Runtime doku üretimi (glow daire, boncuk, göz).
- [ ] Arka plan: hex noktalı ızgara + nokta dokusu TilingSprite, vinyet.
- [ ] Arena sınırı halkası + dış karartma.
- [ ] Yem sprite'ları (ParticleContainer), nabız ve yenme animasyonu.
- [ ] Yılan katmanları (kontur glow, koyu tüp, boncuklar, kafa + bakan gözler), kuyruk solması.
- [ ] Boost parlaması + "Flashes" ışık dalgası.
- [ ] İsimler (BitmapText).
- [ ] Kamera: takip, boyuta göre zoom, doğma zoom animasyonu.
- [ ] Grafik kalite seviyeleri (low/normal/high), framerate sınırı.
- [ ] **Kabul:** Ekran görüntüsü referans oyunla yan yana konduğunda aynı his (renkler, ızgara, yılan stili).

### Faz 3 — Menü, modallar, HUD
- [ ] Fontlar (Türkçe karakter destekli, yerel paketli), renk değişkenleri (CSS custom properties).
- [ ] i18n altyapısı: `t()` fonksiyonu, `tr.ts` + `en.ts` (tip kontrollü), otomatik dil seçimi, ayarlarda Dil satırı.
- [ ] Ana menü: "Yılan.io" logosu (özgün), takma ad + Oyna/Play, Enter, dönen ipuçları (iki dilde).
- [ ] Sağ üst ikonlar (özgün SVG), sağ alt renk seçici + palet popup.
- [ ] Modal bileşeni; Ayarlar (tüm seçenekler, localStorage, anında uygulama).
- [ ] Top scores modalı (sekmeler, liste, spinner; Faz 6'ya kadar sahte veri/çevrimdışı mesajı).
- [ ] Yardım modalı + sayfa altı içerik (özgün metin) + yukarı dön düğmesi + About/Privacy.
- [ ] Bağlanma spinner'ı.
- [ ] HUD: oda skor tablosu (ilk 10 + kendi satırı), istatistik paneli (FPS/Ping/Score/Rank), mini harita.
- [ ] Ölüm → kararma → menü akışı; Esc ile menüye dönüş.
- [ ] Ayar bayrakları HUD'a bağlı (leaderboard/minimap/nicknames gizleme).
- [ ] **Kabul:** Tüm ekranlar ve geçişler çalışıyor; çevrimdışı modda eksiksiz bir oyun döngüsü.

### Faz 4 — Çok oyunculu sunucu
- [ ] `protocol.ts`: tüm mesajlar + encode/decode testleri.
- [ ] `ConnectionManager`: handshake (`JOIN` → `WELCOME`), ping/pong, zaman aşımı.
- [ ] `Room`: World + 30 Hz döngü + bot doldurma (gerçek oyuncu sayısına göre).
- [ ] `RoomManager`: açık odalar, kapasite, "join bigger rooms".
- [ ] `Aoi`: görüş alanı, giren/çıkan yılanlar, yem farkları.
- [ ] Snapshot kodlama (kafa güncellemeleri, giriş kayıtları, gövde yeniden kurma).
- [ ] `LEADERBOARD` (1 sn), `MINIMAP` (2 sn), `DIED`.
- [ ] İstemci `NetClient` + `WorldState` (giriş/güncelleme/çıkış işleme, gövdeyi shared `Body` ile kurma).
- [ ] `OfflineServer` ve `NetClient` aynı arayüzü uygular → oyun kodu ikisini de ayırt etmeden kullanır.
- [ ] **Kabul:** İki tarayıcı sekmesi aynı odada birbirini görüyor, çarpışıp ölebiliyor, skor tablosu ortak.

### Faz 5 — Netcode cilası
- [ ] Interpolasyon tamponu (100 ms), açı enterpolasyonu, ekstrapolasyon sınırı.
- [ ] Kendi yılanında görsel açı tahmini; gerekirse tam tahmin + uzlaştırma.
- [ ] Gövde sapma düzeltmesi (periyodik tam gövde).
- [ ] Nicemleme ve delta kodlama ile bant genişliği ölçümü, hedefe (< 12 KB/s) indirme.
- [ ] Yapay gecikme/kayıp ile test (ör. 150 ms, %2 kayıp) — hâlâ akıcı.
- [ ] Ping göstergesi `ort~sapma`.
- [ ] Bağlantı kopunca menüye dönüş + "Bağlantı koptu" bildirimi.

### Faz 6 — Odalar + kalıcı skor tablosu
- [ ] `Ad@Oda` ayrıştırma (istemci + sunucu doğrulama).
- [ ] Özel oda bekleme salonu, minimum oyuncu, zaman aşımı, kapasite hesabı.
- [ ] `ScoreStore` (SQLite şeması, ekleme, periyot sorguları, takma ad başına en iyi skor).
- [ ] Saatlik `rank_snapshots` ve sıra değişimi hesabı.
- [ ] `GET /api/top` + 30 sn önbellek.
- [ ] Top scores modalı gerçek API'ye bağlı.
- [ ] **Kabul:** Arkadaşlarla `@oda` ile ortak odaya girilebiliyor; günlük/aylık/tüm zamanlar listeleri doğru.

### Faz 7 — Mobil ve gamepad
- [ ] Dokunmatik: joystick modu (görsel halka), arrow modu, ikinci parmakla boost.
- [ ] Ayarlarda "Controls" satırı (sadece dokunmatik cihazlarda).
- [ ] Mobil düzen: HUD ölçekleme, menü yerleşimi, yatay/dikey yönlendirme.
- [ ] `touch-action`, kaydırma/zoom engelleme, iOS Safari tam ekran ipuçları.
- [ ] Gamepad API: çubuk, omuz tuşları, Start/Back, bağlanma/kopma olayları.
- [ ] **Kabul:** iPhone + Android'de akıcı oynanış; Xbox/PS kumandasıyla menüden oyuna tam akış.

### Faz 8 — Performans, test, cila
- [ ] Profil çıkarma (Chrome Performance) → GC sıçramalarını gider, sprite havuzlarını doğrula.
- [ ] LOD ve culling ayarları; düşük seviye cihaz testleri.
- [ ] Bot zekâsı v2 (saldırı/çevreleme davranışı, zorluk karışımı).
- [ ] Oynanış dengeleme: hız, dönüş, boost drenajı, yem yoğunluğu, büyüme eğrisi (oynayarak).
- [ ] Yük testi (200 headless istemci) → tick süresi < 8 ms.
- [ ] Tüm birim/entegrasyon testleri yeşil; tarayıcı uyumluluk listesi tamam.
- [ ] Hata yakalama: WebGL yoksa açıklayıcı mesaj (Canvas fallback opsiyonel).

### Faz 9 — Yerel / LAN çalıştırma + Docker hazırlığı
- [ ] `npm start`: Node sunucusu derlenmiş istemciyi + `/ws` + `/api`'yi tek porttan sunar, `0.0.0.0` dinler, LAN adresini konsola yazar.
- [ ] İstemci WebSocket adresini `location.host`'tan türetir.
- [ ] README (Türkçe): kurulum, `npm run dev`, `npm start`, telefondan bağlanma, güvenlik duvarı izni.
- [ ] Ortam değişkenleri, log, `/health`.
- [ ] Dockerfile + `docker-compose.yml` (yayına hazırlık; nginx/TLS yayın kararı verilince).
- [ ] Favicon, Open Graph görseli.
- [ ] Duman testi: aynı Wi-Fi'daki telefon + ikinci bilgisayar aynı odada oynayabiliyor.

### ~~Faz 10 — Portal sayfası~~ (kapsam dışı)

---

## 20. Kullanıcı Kararları

Tüm ilk sorular yanıtlandı (bkz. §0.1):

1. ~~Oyunun adı~~ → **Yılan.io**
2. ~~Çok oyunculu sunucu ne zaman~~ → **Önce botlarla, sonra sunucu**
3. ~~Barındırma~~ → **Şimdilik yerel (LAN)**
4. ~~Portal sayfası~~ → **Sadece oyun**
5. ~~Render~~ → **PixiJS (WebGL)**
6. ~~Arayüz dili~~ → **Türkçe + İngilizce**

Sonraya kalan açık noktalar:
- İnternete yayına alma zamanı ve yeri (VPS / PaaS) — Faz 9 sonrası.
- "yılan.io" / "yilan.io" alan adlarının müsaitliği — yayın kararıyla birlikte.
- Oynanış dengesi (§7 sayıları) — Faz 1 ve Faz 8'de oynayarak birlikte ayarlanacak.

---

## 21. Bitti Tanımı (Definition of Done)

- Masaüstü ve mobil tarayıcıda menü → oyun → ölüm → menü döngüsü hatasız.
- §2'deki tüm gözlemlenen özellikler (menü, 3 modal, renk seçici, HUD'un 3 parçası, ayarların tamamı, odalar, skor tablosu, kontroller, kurallar) uygulanmış.
- Performans hedefleri (§15) karşılanmış.
- Testler yeşil, `npm run build` temiz.
- Tüm görseller, metinler ve kod özgün.
- Bu dosyadaki "Mevcut Durum" tablosu güncel.
