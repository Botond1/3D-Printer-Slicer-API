# Kalibráció — 2026-08 (J2, anonimizált munkalap)

> Ez a publikus repóba szánt, anonimizált változat. A modelleket kizárólag
> `M01`–`M10` és SHA-256 azonosítja. Az azonosító és a tényleges modellútvonal
> közötti leképezés a tulajdonosnál, sávon kívül marad. Modellútvonalat,
> ügyfélnevet, lead- vagy rendelésazonosítót ebbe a fájlba tilos írni.

## A kapu célja és jelenlegi állapota

A munkalap azt méri, hogy egy pontosan azonosított gép-, folyamat- és
filament-profil, valamint a tényleges Orca bináris becslése használható-e
automatikus árazáshoz. A profil szerkesztése vagy a motor cseréje új identitást
ad, ezért a korábbi mérés nem öröklődik át.

Jelen állapot:
`BAMBU_REFERENCE_9_OF_10_COMPLETE; ORCA_MEASUREMENT_BLOCKED_VENDOR_PROFILE_AND_LOCAL_DOCKER`.
A tulajdonosi Bambu Studio referencia kilenc mérhető modellhez számszerűen
megérkezett; az `M03` 290 mm-es Z kiterjedése miatt a P1S elutasította, ami
határeredmény, nem hiány. A repó
`Bambu_P1S_0.4_nozzle.json` fájlja generikus Marlin-profilt tartalmaz, nem a
valódi Bambu Lab P1S vendor-profilt. A szükséges tulajdonosi bemenetet a
[`configs/orca/H2D-PROFIL-TODO.md`](../configs/orca/H2D-PROFIL-TODO.md)
rögzíti. W8 előtt ezt rendezni kell; a generikus profillal kapott időbecslés nem
minősíti a valódi P1S-t.

## A mérendő profilazonosság

| Tétel | Elvárt érték vagy forrás |
|---|---|
| Gép | a tulajdonos által jóváhagyott P1S 0,4 mm vendor-profil; jelenleg hiányzik |
| Folyamat | `FDM_0.2mm.json` (0,20 mm, 20% kitöltés); a mérési runtime-példányban kötelező `enable_support=0` |
| Anyag | `filament/PLA_generic.json` |
| Névleges sűrűség | 1,24 g/cm³ |
| Névleges szálátmérő | 1,75 mm |
| Motor | a válasz kötelező `engine_version` mezője; a binárisból induláskor ellenőrizve |
| Effektív profil | a válasz `profiles.effective_profile_sha256` mezője |
| Filament-profil | a válasz `profiles.filament_profile` mezője |
| Tényleges filament-adatok | `profiles.filament_diameter_mm` és `profiles.filament_density_g_cm3` |
| Orientáció | előfeldolgozott geometria; Orca CLI `--arrange 1 --orient 0` |

Az `engine_version` és a `profiles.effective_profile_sha256` értékét a mérési
válaszból kell átvenni, nem kézzel beírni. A digest tartalmazza a tényleges
machine → process → filament réteget és az anyagot; profil nélküli anyagnál a
`filament_profile` értéke `null`, és a digest eltér. Ez a kézi árazásra való
biztonságos visszaesés része.

## A tíz referencia-modell

A SHA-256 az elsődleges azonosító. A méret csak tájékoztató adat.

| # | Azonosító | Méret | SHA-256 | Jelleg |
|---|---|---:|---|---|
| 1 | `M01` | 12,4 KB | `961b1bfa3e4ef9f27c0d9de5836b68570030df58eb6bc3b6fe5556b802feba36` | kis funkcionális tartó |
| 2 | `M02` | 25,5 KB | `4bfe32c696a57acfeb3be071120a2057d8020fcabbdbbeff718c426715a0b924` | kis tartó |
| 3 | `M03` | 168 KB | `1c2fb6e4f8030c70caad4370797bdd2998caaf8be0c7f9531dec3e0e153131d4` | lapos, nagy felületű |
| 4 | `M04` | 223 KB | `4502e6a371de3aec76aa0737c689456cc2df19d5e335df25ebf2134664395f04` | kétrészes alkatrész felső fele |
| 5 | `M05` | 340 KB | `b194dfcc8a1f5c948cc6ea416c6e1ffb4672b7654088778b1372c9f182f0a13e` | támasz-igényes figura |
| 6 | `M06` | 909 KB | `da7099a8d44b794ed180f521d5065f28831adef5ccd541bfe397a1a603a3b81a` | menetes adapter, vékony fal |
| 7 | `M07` | 1,31 MB | `db3b3b0e14d217a38830447e4b35bd10b515f82fc80458d1c5e36b3d5a0d6b20` | ipari alkatrész |
| 8 | `M08` | 2,23 MB | `89c02747052a9aabde75b64b5d88c256bcd1aa44d398c09713de8a5d21fe620e` | nagyobb lapos tartó |
| 9 | `M09` | 4,74 MB | `dba611335646afdb890466c363f429b6d19cdcd17a2dcbf1e22b4ffcc6fb524f` | organikus forma, sok háromszög |
| 10 | `M10` | 6,90 MB | `36ec46497f07c796e9bf510206d52bf1de376b4f0b781a1280540103b61fb16a` | nagy szűrőlap |

## Mérési tábla

Az Orca-oszlopokat a kalibrációs futtató tölti ki. A Bambu Studio értékeket a
tulajdonos olvassa le ugyanazzal a gép-, fúvóka-, anyag-, sűrűség-, átmérő-,
réteg-, kitöltés-, támasz- és orientáció-beállítással.

Az előjeles eltérés képlete (`+` = Orca többet becsül):

```text
eltérés % = (orca - bambu) / bambu * 100
```

| Modell | Orca idő (mp) | Orca gramm | Bambu idő (mp) | Bambu gramm | Eltérés idő % | Eltérés gramm % |
|---|---:|---:|---:|---:|---:|---:|
| `M01` | függőben | függőben | 714 | 0,72 | ____ | ____ |
| `M02` | függőben | függőben | 6420 | 46,33 | ____ | ____ |
| `M03` | elutasítás függőben | nem alkalmazható | P1S-határ felett | nem alkalmazható | nem alkalmazható | nem alkalmazható |
| `M04` | függőben | függőben | 9900 | 91,86 | ____ | ____ |
| `M05` | függőben | függőben | 3396 | 19,95 | ____ | ____ |
| `M06` | függőben | függőben | 1578 | 7,17 | ____ | ____ |
| `M07` | függőben | függőben | 7680 | 45,06 | ____ | ____ |
| `M08` | függőben | függőben | 6300 | 33,23 | ____ | ____ |
| `M09` | függőben | függőben | 6600 | 36,43 | ____ | ____ |
| `M10` | függőben | függőben | 24360 | 222,47 | ____ | ____ |

**Elfogadási feltétel:**
`max(abs(időeltérés), abs(grammeltérés)) <= 10%` mind a kilenc számszerűen
mérhető modellen. Az `M03` külön határkapu: mindkét útvonalnak el kell utasítania
a P1S 250 mm-es Z határa felett, hamis idő- vagy grammérték nélkül. Egyetlen
kicsúszó mérés vagy eltérő határdöntés esetén a profil nem alkalmas automatikus
árazásra.

### Kötelező referencia-metaadatok

A tulajdonosi leolvasásnak minden modellnél rögzítenie kell:

1. az anyagtípust és a konkrét filament-profil nevét;
2. a sűrűség-beállítást;
3. a szálátmérőt;
4. a nyomtatót, fúvókát, rétegvastagságot, kitöltést és támasz-beállítást;
5. az orientációt, és kézi orientációnál annak pontos leírását;
6. a futtató által ellenőrzött exact `image_id` értékét;
7. az Orca `engine_version`, `profiles.effective_profile_sha256`,
   `profiles.filament_profile`, `profiles.filament_diameter_mm` és
   `profiles.filament_density_g_cm3` értékeit.

Az orientáció nem mellékes: a repó a natív automatikus orientálást kikapcsolja
(`--orient 0`). Eltérő GUI-orientáció két különböző geometriai feladatot jelent,
így az összehasonlítás nem lenne kalibráció.

A mérési futtató a generált Orca runtime process-profilt a digest és a natív
hívás előtt pontosan `enable_support=0` értékre állítja, majd visszaolvassa ezt
az értéket. A natív hívást a production policy-helper építi: a gép és process
`--load-settings`, a filament külön `--load-filaments` argumentum. Ez kizárólag
a referencia-mérés szerződése; a termékprofil támogatás-beállítását nem módosítja.

## Futási szerződés

A tényleges modellútvonalak kizárólag tulajdonos által kezelt, repón kívüli
manifestben szerepelhetnek. A manifest minden sora `M01`–`M10` azonosítót,
elvárt SHA-256-ot és a helyi forrást kapcsolja össze. A futtató a hash-t minden
modell előtt és után ellenőrzi; tartós kimenetben modellazonosságként csak az
anonim azonosító és az ellenőrzött hash jelenhet meg. A mérési mezők mellett
útvonal, fájlnév és könyvtárnév nem jelenhet meg.

A privát forrásútvonal nem kerül Docker-argumentumba vagy bind mountba. A
futtató a hash-ellenőrzött bájtokat egy futás tulajdonában álló, `0700` módú
ideiglenes staging könyvtárba, semleges `input<kiterjesztés>` néven és `0600`
móddal másolja, majd a másolat méretét és SHA-256-át újra ellenőrzi. Docker csak
ezt az anonim másolatot kapja meg read-only bindként; a másolatot és a staging
könyvtárat a futás után pontosan eltávolítja.

A konténer eltávolítása előtt az inspectnek egyszerre kell igazolnia az exact
generált nevet, a futáscímkét, a rögzített kalibrációs purpose-címkét és az exact
image ID-t. Idegen vagy hibás identitásnál nincs törlés. Az eltávolítás után —
illetve már hiányzó névnél — exact-name listázás bizonyítja a hiányt; sikertelen
ellenőrzés esetén a cleanup fail-closed.

Hibánál a tartós diagnosztika csak anonim identitást, korlátozott `phase`
értéket és stabil hibakódot tartalmaz. Nyers Docker/Orca stdout, stderr,
kivételszöveg, útvonal vagy fájlnév nem kerül a JSON-rekordba vagy a Markdown-
táblába. A futtató előre egy exact `sha256:<64 hex>` image ID-ra oldja fel a
képet, és a konténert ezzel az ID-val indítja. Elfogadható sikeres rekord csak
az exact `image_id`, a binárisból mért `engine_version`, az
`effective_profile_sha256`, valamint a filamentprofil neve, tényleges átmérője
és sűrűsége együttes kötésével jöhet létre.

```sh
npm run sz-b2:calibrate -- \
  --manifest <owner-controlled-manifest> \
  --image <exact-local-image> --memory 2g \
  --machine <owner-approved-machine-profile> --material PLA --layer 0.2
```

A parancsot interaktívan kell kitölteni; a valódi manifest- vagy modellútvonal
nem kerülhet repóban tárolt shell historyba, evidence-be vagy teszt-fixtúrába.
A kiválasztott Orca filamentprofil kalibrációjánál a mért tömeg forrása kizárólag
a pozitív G-code gramm-marker; hiánya vagy driftje HTTP 500
`SLICE_OUTPUT_UNPARSED`, és sem nulla, sem hossz/sűrűség alapú pótlás nem
engedett. OpenAPI-ban a `stats.material_used_g` kötelező, de nullable mező.
Filamentprofil nélküli Orca-válasznál a `material_used_g`, a `hourly_rate` és a
`stats.estimated_price_huf` is `null`; a futtatás nem állíthat elő automatikus
árat ebből az eredményből. A jelenlegi Prusa FDM profil szintén nem ad közvetlen
gramm-markert, ezért a Prusa sikeres ága null tömeggel és kézi árral tér vissza.

## Értelmezési korlátok

- A grammot főként geometria, kitöltés, támasz, sűrűség és átmérő viszi; az időt
  a gép sebesség- és gyorsulásadatai is. Csak időeltérés esetén először a
  gépprofilt kell vizsgálni, nem utólagos időszorzót bevezetni.
- Három modell durva hibák kiszűrésére elég lehet, a ±10%-os árazási kapuhoz
  nem. Ebben a munkalapban a kilenc számszerű modell és az `M03` külön
  P1S-határeredménye együtt alkotja a kötelező tízmodell-es készletet.
- A PETG külön filament-profilt és eltérő effektív digestet kap, ezért külön
  kalibráció szükséges; nem örökölheti a PLA eredményét.
- Egy korábbi, sávon kívüli Prusa-referencia az `M09` nagyságrendjét 0,20 mm
  PLA-nál körülbelül 0,70 óra és 18,1 g értékre tette, támasz nélkül. Ez csak
  durva anomáliajelző, nem Bambu Studio referencia és nem helyettesíti a kaput.

## Ami még nincs ellenőrizve

- A tulajdonos által jóváhagyott P1S és H2D vendor-profil nincs a repóban.
- A kilenc számszerű Bambu Studio referencia rögzített; a tényleges Orca-mérés
  nincs lefuttatva, mert a jóváhagyott vendor-profil hiányzik, és a helyi Docker
  daemon ezen a checkpointon nem volt elérhető.
- A helyi/hostolt image, memória-csúcs és a végleges erőforráslimit e
  dokumentummal nincs igazolva.
- A fogyasztói automatikus árazás elfogadása külön, tulajdonos által vezérelt
  ellenőrzés; ez a repó nem módosít fogyasztói rendszert.

---

## Kiegészítés — 2026-09-02 (3.2.0, Bambu Studio motor)

A fenti munkalap a 2026-08-as J2 állapotot rögzíti, és változatlanul marad.
Ez a kiegészítés a `feat/bambu-engine-overhaul` ág mért eredményeit veszi fel.

### Új mérőút: `POST /bambu/slice`

- A szolgáltatás harmadik motorja a Bambu Studio `02.08.02.61` headless CLI
  (`/opt/bambustudio`, wrapper `/usr/local/bin/bambu-studio`). A gép-, folyamat-
  és filamentprofil a Bambu Studio hivatalos BBL vendor-lánca, laposítva a
  `/opt/bambustudio/resources/profiles/BBL` könyvtárból; a nyilvános
  azonosítókat a `configs/bambu/printers.json` regisztrációs fájl köti a pontos
  vendor-nevekhez (`P1S` alapértelmezett, `H2D`; anyagok `PLA`/`PETG`/`ABS`/
  `TPU` → `Generic ...` filamentek). Ezzel a korábbi
  `ORCA_MEASUREMENT_BLOCKED_VENDOR_PROFILE` akadály a Bambu-útra nézve
  megszűnt: a vendor-profil nem a repóban van, hanem a bináris csomagjában.
- A hívás `--arrange 0 --orient 0`; az elhelyezést az API végzi a valódi
  tálcageometria alapján (`bambu-bed-geometry.js`, `bambu-placement.js`,
  `scale_model.py --place-min-x/--place-min-y`), és a válasz `placement_mm`
  mezőben közli. Mért, befogadó (inclusive) határok: P1S `256 x 228 x 250 mm`
  (a `18 x 28 mm` kizárt sarok miatt L alakú a tartomány, alternatív alaplap
  `238 x 256`), H2D `325 x 320 x 325 mm` (egyszálas, első extruder terület).
  A `+0,1 mm` bármely tengelyen HTTP 422 `MODEL_OUT_OF_PRINTER_BOUNDS`.
- A megőrzött artefaktum a nyomtatókész `.gcode.3mf`; a statisztika a szeletelt
  tálca G-kódjából származik (`total estimated time` az elsődleges időmarker).

### Bambu Studio CLI és a tulajdonosi GUI-leolvasás egyezése

A tíz referencia-modellen (`M01`–`M10`, ugyanazzal a gép-, fúvóka-, anyag-,
réteg-, kitöltés- és orientációbeállítással, támasz nélkül) a headless CLI a
tulajdonos Bambu Studio GUI-leolvasásaitól idő tekintetében `-1,1..+0,1 %`,
tömeg tekintetében `0..0,2 %` eltéréssel tér el. Ez teljesíti a fenti
`<= 10 %` elfogadási feltételt, ezért Bambu Lab nyomtatókra a
`POST /bambu/slice` az árazási referencia. A futtató:
`tests/testing-scripts/calibration/bambu_reference_comparison_runner.py`
(kizárólag tulajdonosi, privát bemenettel; a jelentés csak indexet és
SHA-256 előtagot tartalmaz).

Az Orca 2.3.1 a csomagolt BBL profilokkal ugyanezeken a modelleken legfeljebb
`+24 %`-kal becsül többet, és nincs H2D profilja; a Prusa és Orca út
kompatibilitási céllal marad, a `H2D-QUOTE` továbbra is P1S fizika egy
H2D-méretű tálcán, csak árajánlathoz.

### Támasz-figyelmeztetés

A `supports` mező minden motoron elérhető, alapértelmezése `true`. Bekapcsolt
támasszal (fa, automatikus) a túlnyúlásos modellek ideje `+47..+140 %`-kal nő a
támasz nélküli értékhez képest. Leolvasást és kérést csak azonos
támaszbeállítással szabad összevetni; a támasz nélküli referenciát
`supports=false` kéréssel kell reprodukálni.

### Termelési borítékos füstpróba (2026-09-02, 40 mm PLA kocka, 0,2 mm, 20 %, támasz be)

| Motor | Idő (mp) | Gramm | Ár (Ft) |
|---|---:|---:|---:|
| Bambu P1S | 2453 | 24,00 | 550 |
| Bambu H2D | 2452 | 23,94 | 550 |
| Prusa | 1980 | 24,7 | 440 |
| Orca | 2760 | 24,2 | 620 |

A Prusa ára korábban 450 Ft volt ugyanerre az időre: az árképzés mostantól
egész számú aritmetikával számol (`ceil(max(mp, 900) * óradíj / 3600)`, majd
felfelé 10 Ft-ra), így az 1980 mp × 800 Ft/h pontosan 440. Az Orca generikus
profilja `estimated printing time (normal mode)` markert ad, ezért az Orca
számai nem változtak a `total estimated time` elsőbbségétől. A `/render`
végpont érvényes PNG-t adott.

### Ami továbbra sem ellenőrzött

- Fizikai nyomtatás (falióra-idő) egyik motorhoz sem készült.
- A Bambu H2D valós hardveren nem mért; a `325 x 320 x 325` érték a CLI
  befogadási határa, nem nyomtatott bizonyíték.
- Az SLA út (Elegoo Saturn 4 Ultra) külön hullám; az SLA válasz tömege és ára
  továbbra is `null`.
- A 3.2.0 kép nincs publikálva, telepítve vagy útvonalra kötve; ezek külön
  tulajdonosi engedélyt igényelnek.
