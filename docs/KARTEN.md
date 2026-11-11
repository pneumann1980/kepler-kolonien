# Kommandokarten: vollständiger Katalog (v1.0)

Begleitdokument zu [`KONZEPT.md`](KONZEPT.md) §5.
**Umfang:** 5 Decks à 20 Karten = **100 Karten**, 67 Kartentypen. Wie viele Exemplare es von einem Typ gibt, steht in der Spalte „Anz.“.
**Status:** Eigene Inhalte, Werte vorläufig. Sie werden über Bot-Simulationen ausbalanciert (KONZEPT §14). Übernommen wurde nur die Rahmenmechanik des Regelhefts (Decks, Kosten 0–4, Spielzeitpunkte), keine Kartentexte.

---

## 1. Rahmenregeln (aus dem Regelheft)

- **Kaufen:** in Zugphase 3, 1 Energie pro Karte, höchstens 4 pro Zug, **ein** Kaufvorgang (alle Karten wählen, dann aufdecken). Nur aus Decks, deren Kommandant im Spiel ist.
- **Ausspielen:** Der passende Kommandant muss im Spiel sein, und die **Power-up-Kosten** (0–4 Energie) werden beim Ausspielen bezahlt. Karten werden nacheinander vollständig abgehandelt.
- **Öffentlich** ist, wie viele Karten ein Spieler von welchem Deck hält; der Inhalt ist geheim.
- **Kein Neumischen:** Ein leeres Deck bleibt leer.
- **3-Gebiete-Bonus:** 1 Karte nach Wahl gratis (aus einem Deck mit Kommandant im Spiel).
- **Nuklearschäden sind keine Invasionen.** Sie lösen keine Invasions-Trigger aus und zählen nicht für den 3-Gebiete-Bonus.
- **Ausscheiden:** Die Handkarten werden abgelegt.

## 2. Zeitpunkte

| Code | Engine-Timing | Wann | Wer |
|---|---|---|---|
| **VOR** | `beforeInvasions` | Eigener Zug, Phase 4: nach dem Kartenkauf, vor der ersten Invasion und vor jeder Bewegung | aktiver Spieler |
| **ANG** | `onOwnInvasion` | Eigene Invasion erklärt, vor dem ersten Wurf | aktiver Spieler |
| **REA** | `onInvasionDeclared` | Ein anderer Spieler hat eine Invasion erklärt, vor dem ersten Wurf | jeder außer dem Angreifer, sofern die Kartenbedingung erfüllt ist |
| **ERO** | `onConquest` | Ein Gebiet wurde erobert, vor dem Nachziehen bzw. direkt danach (je Karte) | der Spieler, der das Gebiet verloren hat |
| **KAR** | `onCardPlayed` | Ein anderer Spieler hat eine Karte gespielt, vor deren Abhandlung | jeder außer dem Ausspielenden |
| **ENDE** | `endOfTurn` | Eigener Zug, nach der Truppenbewegung | aktiver Spieler |
| **GEBOT** | `onBid` | Zusammen mit dem eigenen Gebot (verdeckt) | jeder Bietende |
| **WERT** | `endOfGame` | Wertung nach Jahr 5, in Zugreihenfolge | jeder |

Im **Asynchron-Modus** werden REA-, ERO- und KAR-Karten ausschließlich über **Reaktionsregeln** gespielt (KONZEPT §7.4). Die Spalte „Bot/Regelvorlage“ liefert dafür die Ein-Tap-Vorlage.

**Begriffe:**
- *Einheiten* = MODs und Kommandanten.
- *Reichweite n* = höchstens n Grenzübertritte von einem eigenen Gebiet aus, über beliebige Gebiete.
- *Besitzer wählt* = Verluste nach der `casualtyPolicy` des Betroffenen.
- **Wert** = grobe Schätzung in Energie-Äquivalent (1 MOD ≈ 1 Energie) für Bot und Balancing. Darin sind Kaufpreis und Power-up noch **nicht** abgezogen.

---

## 3. Land-Deck (Land-Kommandant) – 20 Karten

Schwerpunkt: Verstärkung, Bodenverteidigung, Durchbruch an Landfronten.

| ID | Name | Anz. | Power-up | Zeit | Effekt | Wert | Bot/Regelvorlage |
|---|---|---|---|---|---|---|---|
| LAN-01 | Gezielte Mobilisierung | 3 | 0 | VOR | +3 MODs in das Gebiet deines Land-Kommandanten | 3 | Sofort spielen, wenn der Land-Kdt an einer Front steht |
| LAN-02 | Tarnstellung | 2 | 1 | REA | Invasion in ein **Landgebiet** erklärt: +2 MODs des Verteidigers in das angegriffene Gebiet. Darf auch zugunsten eines anderen Verteidigers gespielt werden | 2–4 | `target: mine, targetUnitsAtMost: 3` / „hilf, wenn der Angreifer Führender ist“ |
| LAN-03 | Grabenkrieg | 2 | 1 | REA | Eigenes Landgebiet angegriffen: Der Angreifer würfelt in dieser Invasion mit höchstens 2 Würfeln | 2 | `target: mine, attackerUnitsAtLeast: 6` |
| LAN-04 | Sturmangriff | 2 | 1 | ANG | Eigene Invasion von oder in Land, Land-Kdt im Quellgebiet: Bis zu 2 Angriffswürfel sind W8 statt 1 | 2 | Bei Zielen mit Station oder Kommandanten |
| LAN-05 | Nachschubkolonne | 1 | 1 | VOR | +1 MOD in jedes eigene Gebiet, das an ein gegnerisches Landgebiet grenzt (max. 5) | 3–5 | Bei ≥ 4 Frontgebieten |
| LAN-06 | Garnison | 1 | 3 | VOR | Ein eigenes Landgebiet: Bis zu deinem nächsten Zug verteidigen alle Einheiten dort mit W8 | 3 | Für Bonus-Schlüsselgebiete ohne Station |
| LAN-07 | Rekrutierungswelle | 2 | 2 | VOR | +4 MODs, beliebig verteilt auf eigene Gebiete eines Kontinents, in dem du ≥ 3 Gebiete kontrollierst | 4 | Früh im Zug, vor Angriffen |
| LAN-08 | Brückenkopf | 1 | 1 | VOR | Bis Zugende gilt ein eigenes Küstengebiet als benachbart zu allen Landgebieten, die an dasselbe Wassergebiet grenzen (auch ohne Marine-Kdt) | 2 | Wenn ein Bonus-Gebiet nur über Wasser erreichbar ist |
| LAN-09 | Verbrannte Erde | 1 | 0 | ERO | Eigenes Landgebiet erobert: 2 der nachgezogenen Einheiten des Eroberers werden vernichtet (mindestens 1 bleibt) | 2 | Immer, wenn ≥ 3 Einheiten nachgezogen werden |
| LAN-10 | Feldkommando | 1 | 2 | VOR | Bis zu deinem nächsten Zug würfelt in jedem eigenen Gebiet, das an das Gebiet deines Land-Kdt grenzt, ein Verteidigungswürfel als W8 | 3 | Wenn ≥ 3 Nachbarn bedroht sind |
| LAN-11 | Offensivprämie | 1 | 0 | ENDE | Hast du in diesem Zug ≥ 2 umkämpfte Landgebiete erobert: +2 Energie | 2 | Zugende, wenn die Bedingung erfüllt ist |
| LAN-12 | Hinterhalt | 1 | 2 | REA | Eigenes Landgebiet angegriffen: W6 vor dem ersten Wurf; bei 4–6 verliert der Angreifer 1 Einheit (Besitzer wählt) | 1 | `target: mine` |
| LAN-13 | Territorialanspruch | 1 | 0 | WERT | +1 Punkt je vollständig kontrolliertem Kontinent | 1–3 | Immer |
| LAN-14 | Kommandowechsel | 1 | 0 | VOR | Versetze deinen Land-Kdt in ein beliebiges eigenes Gebiet (auch Wasser oder Mond) | 1 | Wenn der Land-Kdt im Hinterland steht |

**Summe: 20**

---

## 4. Marine-Deck (Marine-Kommandant) – 20 Karten

Schwerpunkt: Energie, Mobilität über Wasser, Seeverteidigung.

| ID | Name | Anz. | Power-up | Zeit | Effekt | Wert | Bot/Regelvorlage |
|---|---|---|---|---|---|---|---|
| NAV-01 | Tiefsee-Raffinerie | 3 | 0 | VOR | +1 Energie je eigenem Wassergebiet (max. 4) | 1–4 | Sofort, wenn ≥ 2 Wassergebiete |
| NAV-02 | Strömungsvorstoß | 1 | 1 | VOR | Bis Zugende grenzen deine Wassergebiete an alle Gebiete derselben Wasserkolonie und an deren Küstengebiete | 2 | Wenn ein Ziel so in Reichweite kommt |
| NAV-03 | Minenfeld | 2 | 2 | REA | Eigenes Wassergebiet angegriffen: Der Angreifer verliert vor dem ersten Wurf 1 Einheit (Besitzer wählt) | 1–2 | `target: mine, targetType: water` |
| NAV-04 | Amphibienlandung | 2 | 1 | ANG | Eigene Invasion aus Wasser in Land: Bis zu 2 Angriffswürfel sind W8 | 2 | Bei Küstenangriffen auf Bonusregionen |
| NAV-05 | Konvoi | 2 | 1 | VOR | Bewege bis zu 5 Einheiten zwischen zwei eigenen Gebieten, die an dieselbe Wasserkolonie grenzen (zusätzlich zur Truppenbewegung) | 2–3 | Zur Frontverlagerung |
| NAV-06 | Unterwasserbergbau | 2 | 0 | VOR | +2 Energie; +1 weitere, wenn du eine Wasserkolonie vollständig kontrollierst | 2–3 | Sofort |
| NAV-07 | Torpedo-Salve | 1 | 2 | VOR | Gegnerisches Küstengebiet neben einem eigenen Wassergebiet: 2 W6, je 5–6 → −1 Einheit (Besitzer wählt). Keine Invasion | 1,3 | Gegen stark besetzte Küsten des Führenden |
| NAV-08 | Seesperre | 1 | 2 | VOR | Ein eigenes Wassergebiet kann bis zu deinem nächsten Zug nicht angegriffen werden | 2 | Für Kolonie-Bonus-Schlüsselgebiet |
| NAV-09 | Hafenausbau | 1 | 2 | VOR | Hafenmarker in ein eigenes Küstengebiet: Beim Einkommen +1 MOD dort, solange du es kontrollierst | 3–6 | Früh im Spiel, auf einem sicheren Gebiet |
| NAV-10 | Sonar-Täuschung | 1 | 1 | REA | Eigenes Wassergebiet angegriffen: Der Angreifer würfelt in dieser Invasion nur W6 | 2 | `target: mine, attackerHasD8: true` |
| NAV-11 | Flottenverlegung | 1 | 0 | VOR | Versetze deinen Marine-Kdt in ein beliebiges eigenes Gebiet | 1 | Wenn der Marine-Kdt bedroht ist |
| NAV-12 | Küstenpatrouille | 2 | 0 | VOR | Je +1 MOD in bis zu 3 verschiedene eigene Wassergebiete (weniger, wenn du weniger hast) | 1–3 | Bei ≥ 2 Wassergebieten |
| NAV-13 | Herrschaft der Meere | 1 | 0 | WERT | +1 Punkt je vollständig kontrollierter Wasserkolonie; +1 zusätzlich bei ≥ 5 Wassergebieten | 1–4 | Immer |

**Summe: 20**

---

## 5. Raum-Deck (Raum-Kommandant) – 20 Karten

Schwerpunkt: Stationen, Mond, Orbitalmobilität, Energie über Stationen.

| ID | Name | Anz. | Power-up | Zeit | Effekt | Wert | Bot/Regelvorlage |
|---|---|---|---|---|---|---|---|
| SPC-01 | Orbitaler Nachschub | 3 | 2 | VOR | +3 MODs in das Gebiet einer eigenen Station | 3 | Station an der Front |
| SPC-02 | Orbitale Verstärkung | 1 | 2 | REA | Gebiet mit eigener Station angegriffen: Verlege vor dem ersten Wurf bis zu 3 Einheiten aus einem anderen Gebiet mit eigener Station dorthin | 2–3 | `target: mine, hasStation: true` |
| SPC-03 | Mondbasis-Ausbau | 2 | 1 | VOR | Marker in ein eigenes Mondgebiet: +1 Wertungspunkt, solange du es kontrollierst | 1–2 | Ab Jahr 3 |
| SPC-04 | Orbitalsprung | 2 | 1 | VOR | Bewege bis zu 4 Einheiten aus dem Gebiet einer eigenen Station in das Gebiet einer anderen eigenen Station | 2 | Frontverlagerung |
| SPC-05 | Landekapsel | 2 | 2 | ANG | Eigene Invasion von oder in ein Mondgebiet: Alle Angriffswürfel sind W8 | 3 | Bei Mondangriffen mit ≥ 2 Würfeln |
| SPC-06 | Fertigbau-Modul | 2 | 0 | VOR | Baue sofort eine Raumstation für 3 statt 5 Energie (Limits gelten) | 2 | Wenn < 4 Stationen und ≥ 3 Energie |
| SPC-07 | Orbitales Bombardement | 1 | 3 | VOR | Gegnerisches Gebiet, das an ein Gebiet mit eigener Station grenzt: 3 W6, je 5–6 → −1 Einheit (Besitzer wählt). Keine Invasion | 2 | Gegen Bonus-Blocker |
| SPC-08 | Schildgitter | 1 | 2 | REA | Gebiet mit eigener Station angegriffen: In dieser Invasion zählt jeder Verteidigungswürfel +1 | 3 | `target: mine, hasStation: true, attackerUnitsAtLeast: 5` |
| SPC-09 | Satellitenaufklärung | 1 | 0 | VOR | Sieh dir die Handkarten eines Spielers an (nur für dich sichtbar) | 1 | Vor großen Angriffen auf Spieler mit ≥ 2 REA-fähigen Decks |
| SPC-10 | Mondkolonisten | 1 | 1 | VOR | +1 MOD in jedes eigene Mondgebiet (max. 4) | 1–4 | Bei ≥ 2 Mondgebieten |
| SPC-11 | Erdlandung | 2 | 2 | VOR | Bis Zugende darfst du **einmal** von einem eigenen Mondgebiet aus invadieren: Ziel ist ein aufgedecktes Landgebiet (Land-Gebietskarte). Ist es verwüstet, verfällt der Effekt; gehört es dir, darfst du Einheiten dorthin verlegen | 2 | Einziger Weg Mond → Erde; nutzen, wenn ≥ 4 Einheiten auf dem Mond |
| SPC-12 | Energiekollektor | 1 | 0 | VOR | +1 Energie je eigener Raumstation | 1–4 | Sofort |
| SPC-13 | Herrschaft über den Orbit | 1 | 0 | WERT | +1 Punkt je eigener Raumstation | 1–4 | Immer |

**Summe: 20**

---

## 6. Nuklear-Deck (Nuklear-Kommandant) – 20 Karten

Schwerpunkt: Schaden ohne Invasion, Flächenwirkung, Risiko für einen selbst. Die Karten sind teurer.

| ID | Name | Anz. | Power-up | Zeit | Effekt | Wert | Bot/Regelvorlage |
|---|---|---|---|---|---|---|---|
| NUC-01 | Präzisionsschlag | 3 | 2 | VOR | Gebiet in Reichweite 2: 3 W6, je 5–6 → −1 Einheit (Besitzer wählt) | 2 | Gegen Gebiete mit Kommandanten oder Bonus-Blocker |
| NUC-02 | Flächenbombardement | 1 | 4 | VOR | Ein beliebiges Gebiet: Die Hälfte der Einheiten wird vernichtet (aufgerundet, Besitzer wählt). Danach W6: bei 1 wird das Gebiet **verwüstet** (alle Einheiten und die Station entfernt) | 4–8 | Nur gegen gegnerische Hochburgen, nie an eigenen Grenzen |
| NUC-03 | Abschreckung | 2 | 1 | REA | Eigenes Gebiet angegriffen: Der Angreifer zahlt 2 Energie oder bricht die Invasion **ohne Wurf** ab (Ausnahme von der Mindestwurf-Regel) | 2 | `target: mine, targetUnitsAtLeast: 4` |
| NUC-04 | EMP-Welle | 1 | 3 | VOR | Bis zu deinem nächsten Zug würfeln alle Kommandanten in einem gewählten Kontinent (inklusive angrenzender Wassergebiete) nur W6 | 3 | Vor einem Angriff auf einen Kontinent mit gegnerischen Kommandanten |
| NUC-05 | Verseuchung | 2 | 2 | VOR | Gegnerisches Gebiet in Reichweite 2: −2 Einheiten (mindestens 1 bleibt); es zählt beim nächsten Einkommen seines Besitzers nicht | 2–3 | Gegen ein Gebiet, das den Bonus eines Gegners sichert |
| NUC-06 | Taktischer Sprengkopf | 2 | 1 | ANG | Eigene Invasion erklärt: Der Verteidiger verliert vor dem ersten Wurf 1 Einheit (Besitzer wählt) | 1,5 | Bei knappen Angriffen (P zwischen 0,4 und 0,7) |
| NUC-07 | Erstschlag-Doktrin | 1 | 2 | VOR | Bis Zugende würfelt dein Nuklear-Kdt bei Invasionen aus seinem Gebiet mit 2 W8 statt 1 (wenn ≥ 2 Würfel) | 2–3 | Bei Angriffswelle aus dem Gebiet des Nuklear-Kdt |
| NUC-08 | Bunker | 2 | 2 | REA | Eigenes Gebiet angegriffen: Der Verteidiger verliert in dieser Invasion pro Wurf höchstens 1 Einheit | 2–3 | `target: mine, isBonusKey: true` |
| NUC-09 | Reaktorüberlastung | 1 | 3 | ERO | Eigenes Gebiet erobert: Die Hälfte der nachgezogenen Einheiten des Eroberers (abgerundet, mindestens 1 bleibt) wird vernichtet | 2–4 | Wenn ≥ 4 Einheiten nachgezogen werden |
| NUC-10 | Kettenreaktion | 1 | 4 | VOR | Gebiet in Reichweite 2: −3 Einheiten dort, −1 Einheit in **jedem** angrenzenden Gebiet (auch in eigenen). In jedem Gebiet bleibt mindestens 1 Einheit | 4–7 | Nur wenn Σ Gegnerverluste ≥ 2 × eigene |
| NUC-11 | Uranhandel | 2 | 0 | VOR | +3 Energie; entferne 1 MOD aus einem eigenen Gebiet (mit ≥ 2 Einheiten) | 2 | Wenn Energie für Kommandant oder Station fehlt |
| NUC-12 | Raketensilo | 1 | 3 | VOR | Solange dein Nuklear-Kdt in seinem aktuellen Gebiet steht, verteidigen dort alle Einheiten mit W8 | 3–5 | Wenn der Nuklear-Kdt in einem Bonus-Schlüsselgebiet ohne Station steht |
| NUC-13 | Gleichgewicht des Schreckens | 1 | 0 | WERT | +1 Punkt je eigenem Kommandanten im Spiel (max. 5) | 2–5 | Immer |

**Summe: 20**

---

## 7. Diplomat-Deck (Diplomat) – 20 Karten

Schwerpunkt: günstige Karten, Verteidigung, Eingriffe in andere Spieler, Gebotsphase.

| ID | Name | Anz. | Power-up | Zeit | Effekt | Wert | Bot/Regelvorlage |
|---|---|---|---|---|---|---|---|
| DIP-01 | Schildgenerator | 2 | 1 | REA | Eigenes Gebiet angegriffen: Der Verteidiger würfelt in dieser Invasion nur W8 | 3 | `target: mine, targetUnitsAtLeast: 3, attackerDiceAtLeast: 3` |
| DIP-02 | Waffenstillstand | 2 | 2 | VOR | Ein gewählter Spieler und du dürft bis zu deinem nächsten Zug nicht gegeneinander invadieren. Nuklearkarten bleiben erlaubt | 3 | Gegen den stärksten Nachbarn vor dem eigenen Zugende |
| DIP-03 | Handelsabkommen | 2 | 0 | VOR | Ein Mitspieler wird gefragt (Zustimmungs-Prompt, Frist 12 h). Bei Zustimmung erhaltet ihr beide je 2 Energie, sonst erhältst du 1 | 1–2 | Mitspieler mit der geringsten Punktzahl fragen |
| DIP-04 | Sanktionen | 2 | 1 | VOR | Ein gewählter Spieler erhält bei seinem nächsten Einkommen 3 Energie weniger (mindestens 0) | 2 | Gegen den Führenden |
| DIP-05 | Geheimverhandlung | 2 | 0 | GEBOT | Dein Gebot zählt +2; bezahlt wird nur der tatsächlich gebotene Betrag. Die Karte wird mit den Geboten aufgedeckt | 2 | Wenn ein früher Zugplatz entscheidend ist |
| DIP-06 | Freies Geleit | 1 | 0 | ENDE | Führe eine zweite Truppenbewegung durch | 2 | Wenn zwei Fronten Verstärkung brauchen |
| DIP-07 | Überläufer | 1 | 2 | VOR | Ein gegnerisches Gebiet mit genau 1 MOD, ohne Kommandant und ohne Station, das an ein eigenes grenzt: Der MOD wird durch einen eigenen ersetzt, das Gebiet gehört dir. Keine Invasion | 3 | Wenn das Gebiet einen gegnerischen Bonus bricht |
| DIP-08 | Spionagenetz | 2 | 0 | VOR | Ziehe 1 Karte aus einem Deck, dessen Kommandant du im Spiel hast (zählt nicht zum Kauflimit) | 1,5 | Sofort |
| DIP-09 | Veto | 1 | 2 | KAR | Annulliere eine gerade gespielte gegnerische Karte; deren Power-up-Kosten bleiben bezahlt. Ein Veto kann nicht mit einem Veto beantwortet werden | 3 | `cardDeck: NUCLEAR, affectsMe: true` oder Karte mit Wert ≥ 4 |
| DIP-10 | Embargo | 1 | 1 | VOR | Ein gewählter Spieler darf in seinem nächsten Zug keine Kommandokarten kaufen | 2 | Gegen Spieler mit vielen Kommandanten im Spiel |
| DIP-11 | Neutralitätszone | 1 | 2 | VOR | Ein eigenes Gebiet kann bis zu deinem nächsten Zug nicht invadiert werden (Nuklearkarten wirken weiter) | 2–3 | Für das wichtigste Bonus-Schlüsselgebiet |
| DIP-12 | Sabotage | 1 | 3 | VOR | Eine gegnerische Station in einem Gebiet, das an ein eigenes grenzt, wird zerstört; bei W6 = 1–2 misslingt die Sabotage | 3 | Gegen Stationen an Mond-Startpunkten des Führenden |
| DIP-13 | Weltrat-Mandat | 1 | 0 | WERT | +3 Punkte, wenn du in jedem Kontinent mindestens ein Gebiet kontrollierst | 0–3 | Immer, wenn erfüllt |
| DIP-14 | Diplomatische Immunität | 1 | 1 | REA | Eigenes Gebiet angegriffen: Fiele in dieser Invasion einer deiner Kommandanten, wird er stattdessen in ein angrenzendes eigenes Gebiet verlegt (falls keines existiert, fällt er) | 2–3 | `target: mine, hasCommander: true` |

**Summe: 20**

---

## 8. Übersicht

| Deck | Kartentypen | Karten | Ø Power-up | REA/ERO/KAR | Wertungskarten |
|---|---|---|---|---|---|
| Land | 14 | 20 | 0,95 | 4 Typen / 6 Karten | 1 |
| Marine | 13 | 20 | 0,80 | 2 / 3 | 1 |
| Raum | 13 | 20 | 1,30 | 2 / 2 | 1 |
| Nuklear | 13 | 20 | 1,85 | 3 / 5 | 1 |
| Diplomat | 14 | 20 | 0,95 | 3 / 4 | 1 |
| **Summe** | **67** | **100** | | **14 / 20** | **5** |

## 9. Balancing-Hinweise

- **Bezugsgröße:** 1 Energie ≈ 1 MOD (Einkommen liefert beides im Verhältnis 1:1). Gesamtkosten einer Karte = 1 (Kauf) + Power-up. Zielwert: Erwartungsnutzen ≈ 1,2–1,8 × Gesamtkosten, damit Kartenkauf attraktiv, aber nicht dominant ist.
- **Ausreißer-Kandidaten**, die in den ersten Simulationen besonders beobachtet werden:
  - LAN-01 (0 Power-up, +3 MODs)
  - NAV-09 (Dauerertrag)
  - NUC-10 (Schwankung)
  - DIP-07 (Bonusbruch ohne Würfel)
  - DIP-09 (Konter auf teure Karten)
- **Reaktions-Dichte:** 20 von 100 Karten sind REA, ERO oder KAR. Mehr Reaktionen machen Asynchron-Partien schwerer verständlich. Die Wiedergabe „Was ist passiert?“ muss jede automatisch gespielte Reaktion zeigen.
- **Mond → Erde** ist nur über SPC-11 möglich (2 Exemplare), entsprechend der Regel „Mond → Erde nur per Karte“. Die Simulation prüft, ob Spieler auf dem Mond „verhungern“. Falls ja: 3 Exemplare.
- Jede Änderung erhöht die Content-Version. Laufende Partien bleiben auf ihrer Version (KONZEPT §10.3).
