# Translation glossary (spec 028 R15)

The site ships in English, Norwegian Bokmål (`nb`) and Turkish (`tr`). The
Bokmål and Turkish text was drafted by Claude and shipped without a
native-speaker review (owner decision, 2026-11-12). Corrections go in
`frontend/src/i18n/<lang>/*.ts`; no code changes are needed.

## Rules

- **Never translated:** LiveNear, DriveCheap, SSB, Kartverket, Statens vegvesen,
  Skatteetaten, Norges Bank, Zillow, Redfin, Mapbox, FINN.no, Geonorge, place
  and area names, and official Norwegian terms that have no English name
  (EU-kontroll). In Turkish, a Norwegian official term may be glossed once in
  brackets, e.g. "trafik sigortası vergisi (trafikkforsikringsavgift)".
- **Tone:** plain and direct, second person. Bokmål uses *du*; Turkish uses the
  polite plural *siz* (e.g. "seçin", "girin").
- **Buttons and links:** Bokmål uses the imperative ("Lagre", "Sammenlign");
  Turkish uses the polite imperative ("Kaydedin", "Karşılaştırın") for actions
  and a noun for tabs ("Karşılaştırma").
- **Numbers inside text:** use `{placeholders}` filled by the formatters, never
  digits typed into a translation.
- **Units:** kr, km, km², kWh, øre, %, "/mnd" (nb) and "/ay" (tr) for per month,
  "/år" (nb) and "/yıl" (tr) for per year.
- **Capitals:** sentence case in all three languages. Turkish dotted/dotless i is
  significant: İ/i and I/ı.

## Money, loans and tax

| English | Bokmål | Turkish |
|---|---|---|
| budget | budsjett | bütçe |
| down payment / equity | egenkapital | peşinat |
| loan | lån | kredi |
| loan rate / interest | lånerente / rente | kredi faizi / faiz |
| establishment fee | etableringsgebyr | kredi tahsis ücreti |
| monthly payment | månedsbeløp | aylık ödeme |
| lease (car) | leasing | kiralama (leasing) |
| lease payment | leasingbetaling | kira ödemesi |
| buy / purchase | kjøpe / kjøp | satın almak / satın alma |
| sell / resale value | selge / bruktverdi | satmak / ikinci el değeri |
| value lost (depreciation) | verditap | değer kaybı |
| total cost of ownership | totale eierkostnader | toplam sahip olma maliyeti |
| fees and taxes | avgifter og skatter | harçlar ve vergiler |
| annual fee (road tax, historic) | årsavgift | yıllık vergi |
| traffic insurance tax | trafikkforsikringsavgift | trafik sigortası vergisi |
| re-registration fee | omregistreringsavgift | tescil devir harcı |
| VAT | merverdiavgift (mva.) | KDV |
| insurance | forsikring | sigorta |
| comprehensive insurance | kaskoforsikring | kasko |
| liability insurance | ansvarsforsikring | trafik sigortası |
| road toll | bompenger | geçiş ücreti |
| toll ring | bomring | ücretli geçiş bölgesi |
| rush hour | rushtid | yoğun saat |
| estimate | anslag | tahmin |
| typical value | typisk verdi | tipik değer |
| your input | din verdi | sizin girdiniz |
| source | kilde | kaynak |
| as of (date) | per | itibarıyla |
| proposed change, not yet law | foreslått endring, ikke vedtatt | önerilen değişiklik, henüz yasalaşmadı |

## Cars

| English | Bokmål | Turkish |
|---|---|---|
| car / used car / new car | bil / bruktbil / nybil | araba / ikinci el araba / sıfır araba |
| electric car (EV) | elbil | elektrikli araba |
| plug-in hybrid | ladbar hybrid | şarj edilebilir hibrit |
| petrol or diesel | bensin eller diesel | benzinli veya dizel |
| dealer / private seller | forhandler / privat selger | bayi / bireysel satıcı |
| listing | annonse | ilan |
| asking price | prisantydning | ilan fiyatı |
| model year | årsmodell | model yılı |
| mileage (km driven) | kilometerstand | kilometre |
| km per year | km per år | yıllık km |
| tyres / winter tyres | dekk / vinterdekk | lastikler / kış lastikleri |
| service | service | bakım |
| charging (home / public) | lading (hjemme / offentlig) | şarj (evde / halka açık) |
| periodic inspection | EU-kontroll | periyodik muayene (EU-kontroll) |
| exit (selling or ending a lease) | avslutning / salg | çıkış |
| ownership period | eierperiode | sahiplik süresi |
| compare / comparison | sammenligne / sammenligning | karşılaştırmak / karşılaştırma |
| checklist | sjekkliste | kontrol listesi |
| before you sign | før du signerer | imzalamadan önce |
| your situation | din situasjon | durumunuz |
| market | marked | piyasa |
| detail | detaljer | ayrıntı |

## Map (LiveNear)

| English | Bokmål | Turkish |
|---|---|---|
| home value | boligverdi | konut değeri |
| median price | medianpris | medyan fiyat |
| price per m² | pris per m² | m² fiyatı |
| commute / commute time | pendling / pendlertid | işe gidiş / işe gidiş süresi |
| drive time | kjøretid | sürüş süresi |
| workplace / work address | arbeidssted / jobbadresse | iş yeri / iş adresi |
| reach (area reachable) | rekkevidde | erişim alanı |
| area / ZIP | område / postnummer | bölge / posta kodu |
| state (US) / county (Norway) | delstat / fylke | eyalet / il (fylke) |
| affordable | innenfor budsjett | bütçeye uygun |
| matches | treff | eşleşmeler |
| legend | tegnforklaring | açıklama |
| share link | del lenke | bağlantıyı paylaş |
| sample data | eksempeldata | örnek veri |
