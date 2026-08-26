# Kalibráció — 2026-08 (J1, anonimizált munkalap)

> Ez a publikus repóba szánt, anonimizált változat. A modelleket kizárólag
> `M01`–`M10` és SHA-256 azonosítja. Az azonosító és a tényleges modellútvonal
> közötti leképezés a tulajdonosnál, sávon kívül marad. Modellútvonalat,
> ügyfélnevet, lead- vagy rendelésazonosítót ebbe a fájlba tilos írni.

## A kapu célja és jelenlegi állapota

A munkalap azt méri, hogy egy pontosan azonosított gép-, folyamat- és
filament-profil, valamint a tényleges Orca bináris becslése használható-e
automatikus árazáshoz. A profil szerkesztése vagy a motor cseréje új identitást
ad, ezért a korábbi mérés nem öröklődik át.

Jelen állapot: `BLOCKED_OWNER_INPUT`. A repó
`Bambu_P1S_0.4_nozzle.json` fájlja generikus Marlin-profilt tartalmaz, nem a
valódi Bambu Lab P1S vendor-profilt. A szükséges tulajdonosi bemenetet a
[`configs/orca/H2D-PROFIL-TODO.md`](../configs/orca/H2D-PROFIL-TODO.md)
rögzíti. W8 előtt ezt rendezni kell; a generikus profillal kapott időbecslés nem
minősíti a valódi P1S-t.

## A mérendő profilazonosság

| Tétel | Elvárt érték vagy forrás |
|---|---|
| Gép | a tulajdonos által jóváhagyott P1S 0,4 mm vendor-profil; jelenleg hiányzik |
| Folyamat | `FDM_0.2mm.json` (0,20 mm, 20% kitöltés, automatikus támasz) |
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
| `M01` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M02` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M03` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M04` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M05` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M06` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M07` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M08` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M09` | függőben | függőben | ____ | ____ | ____ | ____ |
| `M10` | függőben | függőben | ____ | ____ | ____ | ____ |

**Elfogadási feltétel:**
`max(abs(időeltérés), abs(grammeltérés)) <= 10%` mind a tíz modellen. Egyetlen
kicsúszó modell esetén a profil nem alkalmas automatikus árazásra.

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
  nem. A tízmodell-es készlet a kötelező minimum ebben a munkalapban.
- A PETG külön filament-profilt és eltérő effektív digestet kap, ezért külön
  kalibráció szükséges; nem örökölheti a PLA eredményét.
- Egy korábbi, sávon kívüli Prusa-referencia az `M09` nagyságrendjét 0,20 mm
  PLA-nál körülbelül 0,70 óra és 18,1 g értékre tette, támasz nélkül. Ez csak
  durva anomáliajelző, nem Bambu Studio referencia és nem helyettesíti a kaput.

## Ami még nincs ellenőrizve

- A tulajdonos által jóváhagyott P1S és H2D vendor-profil nincs a repóban.
- A tíz modell tényleges Orca- és Bambu Studio-mérése nincs kitöltve.
- A helyi/hostolt image, memória-csúcs és a végleges erőforráslimit e
  dokumentummal nincs igazolva.
- A fogyasztói automatikus árazás elfogadása külön, tulajdonos által vezérelt
  ellenőrzés; ez a repó nem módosít fogyasztói rendszert.
