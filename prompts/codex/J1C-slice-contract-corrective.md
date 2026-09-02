# J1C — A `slice_contract` regresszió: diagnózis és javítás

> ## ✅ 2026-08-26 KIEGÉSZÍTÉS — a megállási pontod FELOLDVA
>
> **A guard-javításodat konténerben igazoltam, ÉS az Orca-blokkolót feloldottam.**
> A vendor-profil hiánya **nem akadály** — kiderült, hogy egyikhez sem kell.
>
> ### 1. A te javításod MŰKÖDIK (VPS, exact image, production-azonos izoláció)
>
> `POST /prusa/slice` → **HTTP 200**:
> ```
> material_used_m:      1.35969   ← valós szám, a bolt bemenete sértetlen
> material_used_g:      null      ← nem 0; a néma nulla megszűnt
> material_used_g_source: null
> estimated_price_huf:  null      ← kézi ár
> hourly_rate:          null
> engine_version:       "2.8.1+linux-x64-GTK3-202409181416"  ← binárisból
> effective_profile_sha256: 4ad9d606…  ← valós 64-hex
> ```
> A verifikációs listám 1., 2. és 3. pontja teljesül. **Ez a rész kész.**
>
> *(Mellékesen a válasz élőben mutatja a Z-hibát:
> `build_volume_limits_mm.max = {x:256, y:256, z:210}`.)*
>
> ### 2. 🔴 AZ ORCA-HIBA OKA MÁS, MINT HITTÜK — és egysoros a javítása
>
> Két külön dolgot találtam, és **egyikhez sem kell vendor-profil**:
>
> **(a) A validációs bukás.** Az `layer_change_gcode` hiánya okozza, nem a vendor-
> profil hiánya. A saját generikus gépprofilunkba beírva:
> ```json
> "layer_change_gcode": "G92 E0"
> ```
> …az Orca **lefut**, `plate_1.gcode` elkészül. *(A PrusaSlicer-kulcs `layer_gcode`
> NEM működik — az Orca átnevezte. Ellenőrizve mindkettő.)*
>
> **(b) 🔴 A FILAMENT-PROFIL SOSEM ÉRVÉNYESÜLT.** Ez a fontosabb, és a J1
> filament-rétegének egész premisszáját érinti.
>
> Az `engine.js` a filament-profilt a **`--load-settings`** listához fűzi:
> ```js
> [orcaMachineConfigPath, configFile, orcaFilamentConfigPath].filter(Boolean).join(';')
> ```
> **Az OrcaSlicer ezt némán figyelmen kívül hagyja.** A filamentnek **külön
> kapcsolója van**: `--load-filaments "f1.json;f2.json"` (`orca-slicer --help`).
>
> Bizonyíték — ugyanaz a modell, ugyanaz a profil, csak a kapcsoló más:
>
> | | `--load-settings`-ben | `--load-filaments`-szel |
> |---|---|---|
> | `filament_density` | **0** | **1.24** |
> | `filament_settings_id` | `""` | beállítva |
> | `total filament used [g]` | **0.00** | **4.12** |
>
> Az ellenőrzés stimmel: 1380,53 mm × π(0,875)² = 3,32 cm³ × 1,24 = **4,12 g**.
>
> **Vagyis a J1 filament-rétege ma nem csinál semmit.** A profilok helyesek
> (`filament_density` és `filament_diameter` benne van mindkettőben) — a
> **bekötés** hibás. Emiatt az Orca úton is `material_used_g: null` lenne,
> ami pont az, amit a réteg meg akart szüntetni.
>
> ### 3. Amit ebből tenned kell
>
> 1. **`--load-filaments`** használata a filament-profilra az `engine.js`-ben,
>    NEM a `--load-settings` lista bővítése. **Írj rá tesztet**, ami a
>    tényleges parancssort állítja — egy bekötés, ami némán nem hat, rosszabb,
>    mint ha nem lenne.
> 2. **`layer_change_gcode: "G92 E0"`** a saját Orca gépprofil(ok)ba.
> 3. **A vendor-profilokra ehhez NINCS szükség.** A megállási pontod jogos volt,
>    de a blokkoló feloldódott. A vendor-profil továbbra is értékes az **idő**-
>    pontossághoz (sebesség/gyorsulás-táblák) és a hiteles tálcamérethez.
>
>    > **TULAJDONOSI DÖNTÉS (2026-08-26): a vendor-profilok bekerülhetnek a
>    > publikus repóba.** A redisztribúciós kérdést helyesen vetetted fel, a
>    > tulajdonos elé vittem, és így döntött. **Tényként rögzítve:** sem te, sem
>    > én nem ellenőriztük, milyen licenc vonatkozik a Bambu Studio
>    > `resources/profiles/` tartalmára — ez a tulajdonos döntése, nem a
>    > miénk, és nem kell újra felvetned.
>
>    **DE A TELJESSÉGI KORLÁT MEGMARAD**, és az technikai, nem jogi: a jelentésed
>    szerint **11 további hivatkozott include-sablon**, H2D-kompatibilis process,
>    BBL 0,1/0,3 process és vendor filamentlánc **hiányzik**, és az Orca 2.3.1
>    kompatibilitás sem igazolt.
>
>    **Ezért a sorrend:** először a fenti két egysoros javítás (`--load-filaments`
>    és `layer_change_gcode`) — azok **teljesek és bizonyítottak**. A vendor-lánc
>    beemelése **külön hullám**, és csak akkor, ha a lánc hiánytalan. **Hiányos
>    láncot ne emelj be** — egy féllánc magabiztos rossz értéket ad, pontosan úgy,
>    ahogy a 210-es Z-korlát tette. Ha a hiányzó fájlok kellenek, kérd őket
>    névvel, és a tulajdonos kinyeri.
> 4. A **Z-korlát** (210-es alapérték) és az **egységes `bed_shape`** a J2-ből
>    változatlanul esedékes: **P1S = 256 × 256 × 250**, **H2D = 350 × 320 × 325**.
>    Ezek **számok, nem vendor-fájlok** — leírhatók redisztribúció nélkül.
>
> A konténer-szintű bizonyítást a javítás után **újra én futtatom** — a
> diagnosztikai környezet a VPS-en készen áll (`r3d-j1c-diag:local`).

**Kiadja:** az orchestrátor. **Végrehajtja:** Codex. **Dátum:** 2026-08-26.
**Tárgy:** a J1 PR #8 hosted Image-kapujának `runtime_resource_contract_failure:slice_contract` bukása.

> **Munkapéldány, nem commitolandó** — a repó publikus.

---

## 0. Jól tettél, hogy megálltál — és megvan a válasz

A helyi Dockered nem volt elérhető, ezért a pontos ok nálad `NOT VERIFIED` maradt.
**Nekem van Docker a VPS-en**, ezért lefuttattam. Nem kell tovább találgatni:
**két külön hiba van, mindkettő konténer-szintű.**

Amit tettem: a J1 ágat a VPS-en buildeltem (`r3d-j1-diag:local`), production-nal
azonos izolációval futtattam (`--user 999:999 --read-only`, tmpfs `/tmp`,
azonos mountok és `EXPECTED_*` értékek), loopback porton, külön hálózaton.
**A production konténerhez nem nyúltam** — végig `healthy` maradt.

---

## 1. 🔴 HIBA 1 — A Prusa út MINDEN szeletelése 500-at ad

### A bizonyíték

```
POST /prusa/slice  (20 mm-es kocka, PLA, 0.2 mm, 20% kitöltés)
→ HTTP 500
{"success":false,
 "errorCode":"SLICE_OUTPUT_UNPARSED",
 "detailCode":"GCODE_FILAMENT_NOT_POSITIVE"}
```

Közvetlenül futtattam a szeletelőt a konténerben, és **a gcode-ban ez áll**:

```
; filament used [mm] = 1359.69      ← valós, pozitív
; filament used [cm3] = 3.27        ← valós, pozitív
; total filament used [g] = 0.00    ← NULLA
```

### A mechanizmus

A PrusaSlicer **kiírja** a `[g]` sort — de **0.00**-t, mert a Prusa profiljainkban
**nincs `filament_density`**. A `parseGcodeMetricsStrict` ezt beolvassa, nem pozitív,
és elutasítja.

**A guard helyesen viselkedik. A bemenet rossz.** De a következmény aránytalan:
a teljes szeletelés 500-zal bukik, ahelyett hogy „gramm nincs → kézi ár"-ra esne.

### Ezért nem fogta meg egyetlen unit teszt sem

A `sz-b2-gcode-metrics.test.js` **beégetett Orca 2.3.1 kimeneten** fut, amiben
valódi gramm van. A valóságban a mi Prusa profilunkkal a `[g]` nulla.
**Ezt csak valódi konténerben lehetett látni** — a 2210/2210 zöld nem hazudott,
csak mást mért.

### Ami a legfontosabb

**A Prusa út a WooCommerce plugin EGYETLEN útja** (teszttel lehorgonyozva:
`assertStringEndsWith('/prusa/slice', ...)`). Ez a regresszió a bolt teljes
árazási útját megölné.

**És a jelentésed ezt másképp állította:** *„Prusa és profil nélküli Orca: `null`
tömeg/ár, kézi árazás; nincs néma nulla."* A valóságban nem `null` ár lesz,
hanem **500**. Nem hibáztatlak — a unit tesztjeid ezt mutatták. De ez pontosan
az az eset, amiért a „bizonyíték, nem állítás" szabály létezik, és amiért a
konténer-szintű ellenőrzés nem opcionális.

---

## 2. 🔴 HIBA 2 — Az Orca út a filament-profillal nem szeletel

### A bizonyíték

```
orca-slicer --load-settings "<machine>;<process>;filament/PLA_generic.json" ...

[error] got error when validate: Relative extruder addressing requires
resetting the extruder position at each layer to prevent loss of floating
point accuracy. Add "G92 E0" to layer_gcode.
run found error, return -51, exit...
```

**Egyetlen gcode sem keletkezik**, tehát a HTTP-válasz is ugyanazzal az
`SLICE_OUTPUT_UNPARSED`-del bukik — de teljesen más okból.

### A mechanizmus

A J1-ben bevezetett filament-profilok (`configs/orca/filament/PLA_generic.json`,
`PETG_generic.json`) **nem kompatibilisek** a generikus gépprofillal: relatív
extruder-címzést kérnek, a gépprofil `layer_gcode`-jában viszont nincs `G92 E0`.

Ez **önálló hiba**, nem az 1-es következménye. Két külön javítás kell.

---

## 3. A javítás iránya

### 3.1 A guard hatóköre — ez a tervezési döntés

A szigorú parse **elve helyes**, tartsd meg. De szét kell választani két esetet:

| Eset | Helyes viselkedés |
|---|---|
| **Nincs filament-profil** (nincs miből grammot számolni) | `material_used_g: null`, ár `null`, **kézi ár** — 200-as válasz. Ezt hitted, hogy már így van. |
| **Van filament-profil, de a gramm hiányzik / a jelölő elcsúszott** | `SLICE_OUTPUT_UNPARSED` — **hangos hiba**, ahogy most. Ez a valódi drift-eset. |

A `[g] = 0.00` **profil-hiányt jelent, nem parse-hibát.** A megkülönböztetés
kulcsa: **kiválasztottunk-e filament-profilt?** Ha nem, a nulla várható, és
nem hiba.

**Ne úgy javítsd, hogy a nullát elfogadod érvényes grammnak.** Az visszahozná a
néma nullát, amit a J1 épp megszüntetett. A gramm legyen `null`, ne `0`.

### 3.1/b TULAJDONOSI DÖNTÉS: TELJES HATÓKÖR

A tulajdonos a **teljes javítást** választotta: az 500-ak megszüntetése **ÉS** a
valódi vendor-profilok beépítése egy menetben. **A vendor-profilok MEGÉRKEZTEK**,
tehát a 3.2 és 3.3 sem vár már bemenetre.

#### A vendor-profilok helye és tartalma

A tulajdonos gépén, EBBEN a repóban (2026-09-02 óta — a LeadPilot projektmappából áthelyezve;
gitignore-olt `input/*` terület): `input/bambu-leolvasas/vendor-profilok/` — **11 JSON + `manifest.md`**
(forrás-útvonalak, SHA-256, Bambu Studio 2.8.2.61; a Studio telepítése érintetlen).

| Lánc | Fájlok |
|---|---|
| **P1S** | `Bambu Lab P1S 0.4 nozzle.json` → `fdm_bbl_3dp_001_common.json` → `fdm_machine_common.json` |
| **H2D** | `Bambu Lab H2D 0.4 nozzle.json` → `fdm_bbl_3dp_002_common.json` → ugyanaz a gyökér |
| **Process** | `0.20mm Standard @BBL X1C.json` → `fdm_process_single_0.20.json` → `fdm_process_single_common.json` → `fdm_process_common.json` |

Plusz a modell-szintű metaadat: `Bambu Lab P1S.json`, `Bambu Lab H2D.json`.

> **🔒 Adatvédelem:** a `vendor-profilok/` mappa a Bambu SAJÁT fájljait tartalmazza,
> ügyféladat nincs benne. **De a SZOMSZÉD mappákban ügyfél-modellnevek és
> screenshotok vannak.** Csak a `vendor-profilok/` alá nyúlj, és a
> forrás-útvonalakat ne írd commitba.

#### 🔴 A P1S magassága 250, NEM 256 — és van egy buktató

Végigkövettem a láncot, fájlonként:

| Fájl | `printable_height` |
|---|---|
| `Bambu Lab P1S 0.4 nozzle.json` | **nincs** (nem ír felül) |
| `Bambu Lab P1S.json` | **nincs** (modell-metaadat) |
| `fdm_bbl_3dp_001_common.json` | **`[]`** ← ÜRES TÖMB |
| `fdm_machine_common.json` (gyökér) | **`"250"`** |

**Tehát a P1S effektív magassága 250 mm**, nem a spec-lap 256-ja. Ez tudatos:
a Bambu ott mondja ki expliciten a 256-ot, ahol kell — az
`X1 Carbon 0.4 nozzle.json` **`"printable_height": "256"`**-ot ír —, a P1S-nél
pedig szándékosan hagyja a gyökér 250-et. A H2D felülírja: **325**.

> **⚠️ A BUKTATÓ:** a P1S szülő-fájljában a mező **üres tömb** (`[]`), nem hiányzik.
> Egy naiv resolver ezt **értéknek** olvashatja, és `0`-t, `NaN`-t vagy üres
> stringet kap — ami után a Z-ellenőrzés vagy mindent elutasít, vagy semmit.
> **Az üres tömb jelentése: „itt nincs beállítva, öröklődik."** Írj rá tesztet.

**A használandó értékek:** P1S = **256 × 256 × 250**, H2D = **350 × 320 × 325**.
Az XY a `printable_area`-ból, a Z az effektív `printable_height`-ből —
**mindkettő a láncból feloldva, ne kézzel beírt számból.**

### 3.2 Prusa filament-sűrűség

Az igazi megoldás, hogy a Prusa út is kapjon **sűrűséget**. A gcode-ban ott van a
`[cm3] = 3.27` — sűrűséggel ebből a motor maga számolja a valós grammot
(1,24 g/cm³ → ~4,05 g). **Ne te szorozz utólag** — add meg a profilnak a sűrűséget,
és a motor írja ki.

A sűrűség a **vendor-profilokból** jön (lásd 3.1/b) — azok **megérkeztek**, tehát
ez a rész sem vár. A Bambu-referencia PLA-ja: **1,24 g/cm³, 1,75 mm**.

> **Ez egyben a kalibráció előfeltétele is.** A referencia-mérés PLA-ra,
> 1,24 g/cm³-mal készült; ha a mi profilunk más sűrűséggel számol, a
> gramm-oszlop összehasonlíthatatlan.

### 3.3 Az Orca filament-kompatibilitás

Derítsd ki, melyik oldal kéri a relatív extruder-címzést (a filament- vagy a
gépprofil), és **oldd fel a valódi vendor-profillal**, ne úgy, hogy a filament
profilból kiveszed a beállítást. A generikus gépprofil a probléma gyökere —
és a valódi P1S/H2D machine-profil épp most érkezett meg.

A valódi P1S/H2D machine-profil **megérkezett** (3.1/b), tehát a felodás
elvégezhető. **Ha a valódi gépprofillal is fennmarad az inkompatibilitás**, az
önálló lelet — jelentsd, és NE úgy oldd meg, hogy a filament-profilból kiveszed
a beállítást, mert azzal a valódi Bambu-viselkedéstől távolodnánk el.

---

## 4. Verifikáció — és itt egy munkamegosztás

A unit tesztek **nem elegendők** ehhez a javításhoz. Bizonyíték csak valódi
konténerből érvényes. Mivel a helyi Dockered nem elérhető:

**Te javítasz és unit teszttel lefeded; a konténer-szintű ellenőrzést ÉN futtatom
a VPS-en**, és visszaküldöm a nyers kimenetet. Ne állítsd „kész"-nek addig.

Amit a javítás után igazolni fogok:

1. `POST /prusa/slice` egy egyszerű testtel → **HTTP 200**,
   `material_used_g: null`, `estimated_price_huf: null`, `hourly_rate: null`.
2. A `material_used_m` **továbbra is valós pozitív szám** — ez a bolt bemenete.
3. Ha van filament-profil és a gramm valós → `material_used_g` pozitív, és az
   ár **nem** null.
4. Elcsúszott gcode-jelölő → **továbbra is** `SLICE_OUTPUT_UNPARSED`.
   *A negatív kontroll nem gyengülhet.*

**Adj hozzá egy unit tesztet a most talált valós bemenetre:** gcode, amiben
`filament used [mm]` pozitív, de `total filament used [g] = 0.00`. Ez a fixtúra
eddig hiányzott, és pontosan ez a hiba.

---

## 4/b 🔴 A KÖZVETETT LELET: a health zöld volt, miközben SEMMI nem működött

Ezt a diagnózis közben vettem észre, és fontosabb, mint maga a hiba.

**A J1 konténer `healthy` állapotba került**, a `/health` `{"status":"OK"}`-t adott,
a Docker healthcheck átment — **miközben a szolgáltatás egyetlen dolga, a szeletelés,
minden hívásnál 500-zal bukott.**

A fogyasztó oldala ugyanezt találta magánál, tőlem függetlenül: van egy „kanári"
mechanizmusuk, ami RFQ-first módra kapcsol és riasztást küld, ha a szeletelő
elromlik — **de a kanári nem szeletel, csak a `/health`-et hívja.** Az ő szavukkal:
*„a neve »canary slice«, és nem szeletel."*

Vagyis ebben a hibamódban **a lánc egyetlen pontja sem szólt volna**: a Docker
healthy, a mi health-ünk OK, az ő kanárijuk zöld, és a vevők szeletelései sorra
elbuknak. Zárt bukás (ajánlatkérésbe futnak, pénzt nem veszítünk), de **némán** —
a tulajdonos abból venné észre, hogy hirtelen tele az ajánlatkérés-lista.

### Feladat: javasolj élettartam-jelzést, ami a KÉPESSÉGET méri

Nem azt, hogy a folyamat fut. Két irányt látok, és a te dolgod eldönteni, melyik
fér bele; **mindkettőnél a javaslatot és az indoklást várom, nem kész kódot**,
kivéve ha az elsőt olcsónak ítéled — akkor építsd meg ebben a menetben.

1. **Indulási füst-szeletelés.** A konténer induláskor egyszer szeleteljen le egy
   beépített, apró modellt. Ha elbukik, a szolgáltatás **ne legyen ready.**
   *Ez a mostani regressziót a konténer indulásánál elkapta volna* — a J1 image
   soha nem lett volna `healthy`, és a hiba deploy-hibaként jelentkezett volna,
   nem néma futásidejű romlásként. Egy szeletelés konténer-indulásonként, olcsó.
2. **Gördülő hibaarány.** Ha az utolsó N szeletelés mind elbukott, a
   `/ready` (vagy a `/health/detailed`) romoljon le. Ingyen van — valós forgalomból
   dolgozik —, de csak utólag reagál.

A kettő együtt fedi a két esetet: az (1) a törött buildet/profilt, a (2) a
futásidejű driftet.

### 🔒 A jelzés helye ELDŐLT: `GET /ready`. Ez szerződés, ne válassz mást.

Két, egymástól független kötöttség metszete, és pontosan egy helyre mutat:

| Kötöttség | Honnan |
|---|---|
| A `GET /health` **maradjon olcsó és auth nélküli** | mindkét fogyasztó erre épít; az egyikük rendszer-őre **kulcs nélkül** pingeli |
| A képesség-jelzésnek **auth nélkül elérhetőnek** kell lennie | a bolt oldala tudatosan **lemondott** az operations-kulcsról |

**Ezért a `/health/detailed` NEM járható út**, pedig kézenfekvőnek tűnik.
A bolt oldala korábban — miután kiderült, hogy a `/prusa/slice` és a
`/health/detailed` két külön audience-be esik — **úgy döntött, hogy nem kér
második kulcsot**, és kivette azt a hívást: az opció, amit töltött, az egész
forrásfájukban íródott, de soha nem olvasódott. Nem érte meg operations-titkot
tartani WordPressben egy senki által meg nem nézett opcióért.

Ha a jelzés a `/health/detailed`-re kerülne, akkor vagy visszavonnák egy jó okból
hozott döntésüket, vagy gépidőt égetnének egy saját próba-szeletelésre. **Egyik
sem jó csere egy jelzésért, ami a `/ready`-n ingyen elfér.**

**Tehát: a képesség-jelzés a `GET /ready`-re megy** — auth nélküli marad, és a
LeadPilot rendszer-őre is eléri. A `/health` változatlanul olcsó liveness marad.

Ha bármi miatt mégis máshova kerülne, az **megállási pont előzetes jelzéssel** —
mindkét fogyasztó tervet változtat tőle.

---

## 5. Munkaszerződés

1. **Izolált korrekciós ág**, ahogy javasoltad. A J1 PR #8 maradjon nyitva, amíg
   ez zöld nem lesz.
2. **Tilos a guardot úgy „javítani", hogy a nullát elfogadja.**
3. **Kötelező megállás:** ha a vendor-profil hiánya blokkol; ha a javítás a
   negatív kontrollt gyengítené.
4. **Kötelező őszinteség:** a *„mi az, ami még NINCS ellenőrizve"* lista — és
   ebben a hullámban külön mondd ki, mit nem tudtál konténerben ellenőrizni.
5. Nem történhet deploy, registry write, publikus route-aktiválás, `docker prune`,
   force-push vagy fogyasztói repó-módosítás.

---

## 6. Amit ebből érdemes megjegyezni

A J0 óta minden hullámban ugyanaz a minta ismétlődik: **a rendszer helyesnek
LÁTSZOTT** — a `MODEL_OUT_OF_PRINTER_BOUNDS` működött, csak rossz határnál;
a `slice_sig` tartalmazta a motorverziót, csak beégetve; a gramm-parse szigorú
volt, csak rossz esetre.

Egyik sem hiányzó funkció volt. Mind **működő funkció rossz bemeneten**, és
mindet csak akkor lehetett meglátni, amikor valaki tényleg futtatta.
