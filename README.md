# ✦ Galaxit

PDF-Reader im Weltraum-Look, mit Autosave. Geschrieben in **JavaScript** (Electron + PDF.js + pdf-lib).

## Herunterladen
Neueste Version unter **[Releases](https://github.com/davidkreidl123-tech/galaxit/releases/latest)**:
`Galaxit-win-x64-vX.Y.Z.zip` an einen Ort mit **kurzem Pfad** entpacken
(z. B. `%LOCALAPPDATA%\Programs`) → `Galaxit\Galaxit.exe` starten.
Tipp: Rechtsklick auf eine PDF → *Öffnen mit* → `Galaxit.exe`.

## Automatische Updates
Galaxit prüft beim Start und danach alle 6 Stunden das neueste GitHub-Release.
Gibt es eine neuere Version, erscheint unten rechts eine Karte → **Jetzt aktualisieren**
lädt das ZIP mit Fortschrittsbalken → **Neu starten & installieren** speichert deine Arbeit,
beendet Galaxit, tauscht die Dateien aus (mit Rollback bei Fehlern) und startet neu.
Manuell: Einstellungen → *Nach Updates suchen*.

## Entwickeln
```powershell
npm install
npm start                 # App aus dem Quellcode starten
npm run build             # Galaxit.exe + ZIP nach dist\ bauen
npm run install-app       # gebaute App nach %LOCALAPPDATA%\Programs\Galaxit + Verknüpfungen
```
Neue Version veröffentlichen (baut, taggt, pusht, legt das GitHub-Release an –
alle installierten Galaxits bekommen das Update automatisch):
```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.1.0 -Notes "Was ist neu"
```

## Funktionen
- Animierter Sternenhimmel, Glas-Oberfläche, Neon-Akzente, eigenes Logo
- Fortlaufendes Scrollen, Seiten-Miniaturen, Zoom (Strg+Mausrad), Text auswählen & kopieren
- Werkzeuge: **Markieren** (rastet an Text ein), **Zeichnen**, **Text**, **Notizen**, **Radierer**, je 8 Farben
- Volltextsuche mit leuchtenden Treffern
- Rückgängig / Wiederholen (300 Schritte)
- Drag & Drop, zuletzt geöffnete Dateien, merkt sich die letzte Seite je Datei

## Autosave
- Speichert **1,5 s nach der letzten Änderung** (einstellbar 0,5–10 s), spätestens alle 20 s.
- Atomar: erst Temp-Datei → dann Original ersetzen. Absturz beim Speichern = keine kaputte PDF.
- Vor der ersten Änderung: Sicherung des Originals in `%APPDATA%\galaxit\backups` (letzte 30).
- Datei gesperrt? → Wiederherstellungskopie im Backup-Ordner + erneuter Versuch alle 5 s.
- Beim Schließen wird Offenes sofort gespeichert.
- Anmerkungen sind **echte PDF-Annotationen** → sichtbar in Acrobat, Edge, Chrome … und in Galaxit später wieder bearbeitbar.

## Tastenkürzel
| | |
|---|---|
| Strg+O / Strg+S / Strg+Umschalt+S | Öffnen / Speichern / Speichern unter |
| V H P T N E | Auswählen, Markieren, Zeichnen, Text, Notiz, Radierer |
| Strg+Z / Strg+Y | Rückgängig / Wiederholen |
| Strg+F, Enter, Umschalt+Enter, F3 | Suchen |
| Strg + / − / 0 | Zoom / an Breite anpassen |
| Bild↑/↓, Pos1, Ende | Blättern |
| Doppelklick auf Text (Auswahl-Werkzeug) | Text bearbeiten |

## Projektaufbau
```
main.js          Fenster, Dateizugriff, atomares Speichern, Backups
updater.js       Update-Prüfung, Download, Austausch der App-Dateien
preload.js       sichere Brücke Renderer ↔ Hauptprozess
renderer/app.js  Viewer, Werkzeuge, Suche, Autosave-Engine
renderer/pdfio.js  Anmerkungen ↔ PDF (pdf-lib, Appearance-Streams)
renderer/stars.js  Sternenhimmel
assets/          Logo (SVG), Icon (PNG/ICO)
```
Icon neu erzeugen: `node scripts/build-icon.js`
