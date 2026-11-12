# Umsetzungsstand (v0.1.0)

Stand: 2026-11-12. Grundlage ist [`KONZEPT.md`](KONZEPT.md) v1.3. Dieses Dokument trennt ehrlich, was fertig und getestet ist, was vereinfacht umgesetzt wurde und was noch fehlt.

## 1. Fertig und getestet

### Spiel-Engine (`src/engine`)
- **Alle Regeln R1–R38** aus KONZEPT §2:
  - Setup: 4 verwüstete Gebiete, Start-MODs, Starteinheiten; Schnell- und klassische Aufstellung; 2-Spieler-Variante mit neutraler Armee.
  - Gebot mit W6-Stichentscheid und freier Platzwahl.
  - Zugphasen in fester Reihenfolge.
  - Einkommen über die **Score-Chart-Tabelle** (inklusive 45 → 14), Boni für MODs und Energie, Stations-MODs.
  - Kommandanten und Stationen mit allen Limits; Kartenkauf in einem Vorgang.
  - Kampf mit W6/W8 nach der Regel „von oder in“, Stationsverteidigung, Verlustregeln, Nachzieh-Pflicht der W8-Kommandanten.
  - Leere Gebiete ohne Wurf; Wasser und Mond nur mit Kommandant im Spiel; Mond nur über Station → Landeplatz.
  - 3-Gebiete-Bonus, Abbruch erst nach einem Wurf, Ausscheiden mit Ablage der Karten.
  - Truppenbewegung über Pfad inklusive Station ↔ Landeplatz.
  - Wertung inklusive Wertungskarten; Gleichstand nach Energie, dann Einheiten.
- **100 Kommandokarten (67 Typen)** aus [`KARTEN.md`](KARTEN.md), alle ausführbar. Zeitpunkte VOR, ANG, ENDE (manuell) sowie REA, ERO, KAR (automatisch), GEBOT (mit dem Gebot) und WERT (bei Spielende).
- **Deterministischer RNG** (sfc32): Der Seed wird beim Start per SHA-256 festgeschrieben und nach Spielende offengelegt. Damit lässt sich jede Partie aus Seed und Befehlsfolge exakt reproduzieren.
- **Projektion:** fremde Handkarten, Gebote vor dem Aufdecken, Deck-Reihenfolge und RNG verlassen den Server nicht. Öffentlich sind Energie sowie Typ und Anzahl der Karten (RH S. 1).
- **Heuristik-Bot (Stufe 1)**: spielt alle Phasen und Kartenarten. Er wird für Gegner, die Vertretung bei Fristablauf und „Kontrolle abgeben“ genutzt.
- **Tests:**
  - 14 Unit-/Property-Tests, darunter Score-Chart, W8-Regeln, Wasser/Mond, Pfadbewegung, Projektion ohne Leaks, Reaktionen.
  - Bot-gegen-Bot-Simulation mit Invarianten-Prüfung nach jedem Befehl: über 100 Partien mit 2–5 Spielern ohne Fehler.

### Server (`src/server`)
- **Profile** (Name und Passwort mit scrypt), Sitzungen per HttpOnly-Cookie. Das erste Profil wird Admin; weitere Admins per `ADMIN_PASSWORD`.
- **Profilseite:** Statistik (Partien, Siege, Ø Punkte), Verlauf, Wunschfarbe, Passwortwechsel. Dazu eine Rangliste.
- **Lobby:** Partien anlegen, beitreten, verlassen, Bots hinzufügen, starten, löschen; Zuschauen bei laufenden Partien.
- **Synchronisation:** WebSocket-Live-Sync (pro Spieler projizierter Zustand, Herzschlag 25 s, Reconnect); Befehle per REST mit Versionsprüfung.
- **Persistenz:** SQLite (WAL) mit Zustand nach jedem Befehl und vollständigem Befehlsprotokoll, Migrationen, tägliches Backup mit Aufbewahrung. Laufende Partien überstehen Neustarts.
- **Fristen:** Nach Ablauf übernimmt ein Bot den säumigen Spieler (Gebot, Aufstellung oder kompletter Zug).
- **Web Push (VAPID)** bei „du bist dran“ und bei Spielende, nur wenn der Spieler gerade nicht verbunden ist.
- **Absicherung:** Rate-Limits für Login, Registrierung, Befehle; Proxy-Modus `cloudflare`; Body-Limit; CSP-Header; optionaler Einladungscode.
- **Integrationstest:** echter Serverprozess, zwei Profile, Lobby, WebSocket, Partie bis zur Wertung, Statistik.

### Client (`src/client`)
- **PWA** (Preact): installierbar, Service Worker mit Offline-App-Shell, Push-Empfang, Icons.
- **Spielbrett:** SVG-Karte (Planet und Mond, eigenes Design aus `tools/board-generator`).
  - Pinch-Zoom und Wischen, nahtloser Ost-West-Umlauf, im Hochformat auf volle Höhe skaliert.
  - Besitzerfarben, Einheiten, Kommandanten, Stationen, Landeplätze, verwüstete Gebiete.
  - Gültige Ziele werden hervorgehoben.
- **Aktionsleiste für alle Phasen:** Aufstellung, Gebot, Platzwahl, Einsetzen, Anheuern/Bauen, Kartenkauf, Karten mit allen Zielarten, Invasion mit Würfelvorschau und exakter Siegwahrscheinlichkeit (Markov), Blitz, Abschreckung, Nachziehen, Bonuskarte, Truppenbewegung, Zugende, Handelsangebote.
- **Weitere Tabs:** Hand (Spielbarkeit mit Begründung, Reaktionsregeln, Verteidigungswürfel), Spieler, Protokoll mit Würfeln.
- **Rückblick** beim Öffnen: „Seit deinem letzten Besuch …“ mit hervorgehobenen Gebieten.
- **Spielende** mit Wertungstabelle und automatischer Prüfung des Würfel-Seeds.
- **Layouts** für Smartphone (Hochformat), Querformat und Tablet.
- **E2E (Playwright gegen den Docker-Container):**
  - iPhone-Durchlauf von der Registrierung bis zum Spielende.
  - Zwei Menschen (iPhone und Android) gegeneinander mit Live-Übergabe des Zugs.

### Betrieb
- **Docker-Image:** baut inklusive Typprüfung und Engine-Tests. Es läuft als PUID:PGID (99:100), Healthcheck `/healthz`, Daten unter `/data`.
- **Deployment-Dateien:** `docker-compose.yml` mit optionalem `cloudflared`, Unraid-Template, GitHub Action für ein Multi-Arch-Image nach GHCR.

## 2. Bewusst vereinfacht

| Thema | Konzept | Umsetzung | Auswirkung |
|---|---|---|---|
| Reaktionskarten | Regel-Editor mit Bedingungen, Live-Fenster | Pro Kartentyp **an/aus**. Jede Karte bringt eine eingebaute, sinnvolle Bedingung mit (z. B. Schildgenerator nur bei mindestens 3 Angreifern). Kein Live-Reaktionsfenster | Keine Wartezeiten, aber weniger Feinsteuerung. Hilfe für Dritte (Tarnstellung für andere) wird nicht automatisch gespielt |
| Verteidigungswürfel | Wahl pro Wurf (RH S. 5) | Globale Einstellung: maximal oder 1 Würfel | Im Asynchron-Betrieb gewollt |
| Verlustauswahl | Betroffener wählt (RH S. 6) | Immer MODs vor Kommandanten | Entspricht fast immer der besten Wahl |
| Event-Sourcing | Events plus Upcaster | Zustands-Snapshot pro Befehl plus vollständiges Befehlsprotokoll (Replay aus Seed und Befehlen möglich) | Kein Replay-Werkzeug in der UI |
| RNG | ChaCha20 | sfc32 (deterministisch, Seed-Commitment wie geplant) | Für ein Spiel ausreichend; der Admin kann den Seed weiterhin lesen |
| Monorepo | pnpm-Workspaces, React, Fastify | Ein Paket, Preact, Node-`http` + `ws`, Node-Type-Stripping | Weniger Abhängigkeiten; Server ohne Build-Schritt |
| Rückblick | Animierte Wiedergabe | Zusammenfassung plus Aufblinken der Gebiete | – |
| Startplatzierung | klassisch reihum | zusätzlich „Schnell“ (Standard): Gebiete zufällig, Rest gleichzeitig | Klassisch ist asynchron sehr langwierig (ein Befehl pro Gebiet) |

## 3. Noch nicht umgesetzt

1. **Ruhezeiten** (keine Pushes bzw. pausierte Fristen nachts), **Erinnerungen** bei 50 % und 90 % der Frist, **Urlaubsmodus**, **ntfy** als zweiter Kanal.
2. **Undo** innerhalb einer Phase.
3. **Tischmodus `/table`** ohne Login. Zuschauen ist für angemeldete Profile möglich.
4. **Bot Stufe 2** (Monte-Carlo) und Schwierigkeitsgrade.
5. **Systematisches Balancing** von Karten und Kontinentboni. Das Werkzeug `src/tools/simulate.ts` existiert, eine Auswertung je Karte fehlt noch.
6. **Barrierefreiheit:** Muster bzw. Symbole zusätzlich zu den Spielerfarben (Farbsehschwäche).
7. **Admin-Seite:** Passwort zurücksetzen, Spieler ersetzen, Fristen verlängern. Bisher kann der Admin nur Partien löschen.
8. **Englische Übersetzung.**
9. **Profil löschen** oder umbenennen.

## 4. Hier nicht verifizierbar

- **Cloudflare Tunnel:** keine Domain in der Testumgebung. Konfiguration und Einstellungen sind dokumentiert, der Server unterstützt `CF-Connecting-IP`, und der WebSocket-Herzschlag ist auf das Cloudflare-Timeout abgestimmt.
- **Web Push:** braucht HTTPS und die echten Push-Dienste von Google, Apple und Mozilla. Schlüsselverwaltung, Abo-Speicherung und der Push-Handler im Service Worker sind implementiert; eine Ende-zu-Ende-Zustellung ist ungetestet.
- **arm64-Image:** lokal wurde nur amd64 gebaut. Die GitHub Action baut beide Architekturen, ist aber noch nicht gelaufen.
- **Echte iOS-/Android-Geräte:** getestet wurde mit Playwright-Geräteemulation (iPhone 13, Pixel 7, iPad). Safari-Eigenheiten (PWA-Push, Pinch-Gesten) sind auf echten Geräten noch zu prüfen.
