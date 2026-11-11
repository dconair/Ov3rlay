"""Struktur-Tests für die generierten Szenen-Collections (ohne OBS lauffähig).

Aufruf: python3 -m unittest discover -s tests -v
"""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build_collection as bc  # noqa: E402

VARIANTS = [(p, m) for p in ("macos", "windows", "linux") for m in (False, True)]


def walk_strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from walk_strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk_strings(value)


class CollectionTests(unittest.TestCase):
    def docs(self):
        for platform, move in VARIANTS:
            yield platform, move, bc.build(platform, move)

    def test_items_reference_existing_sources(self):
        for platform, move, doc in self.docs():
            names = {s["name"] for s in doc["sources"]} | {doc["DesktopAudioDevice1"]["name"], doc["AuxAudioDevice1"]["name"]}
            for source in doc["sources"]:
                if source["id"] != "scene":
                    continue
                ids = [i["id"] for i in source["settings"]["items"]]
                self.assertEqual(ids, sorted(set(ids)), f"{source['name']}: Item-IDs nicht eindeutig")
                self.assertEqual(source["settings"]["id_counter"], len(ids))
                for item in source["settings"]["items"]:
                    self.assertIn(item["name"], names, f"{platform}: {source['name']} -> {item['name']}")
                    self.assertEqual(item["source_uuid"], bc.Collection(platform, move).uid(item["name"]))

    def test_unique_names_and_uuids(self):
        for platform, move, doc in self.docs():
            sources = doc["sources"] + [doc["DesktopAudioDevice1"], doc["AuxAudioDevice1"]]
            for key in ("name", "uuid"):
                values = [s[key] for s in sources]
                self.assertEqual(len(values), len(set(values)), f"{platform}: doppelte {key}")
            uuids = [s["uuid"] for s in sources] + [f["uuid"] for s in sources for f in s.get("filters", [])]
            self.assertEqual(len(uuids), len(set(uuids)), f"{platform}: doppelte UUID bei Filtern")

    def test_only_known_tokens(self):
        for platform, move, doc in self.docs():
            used = set(re.findall(r"\{\{([A-Z_]+)\}\}", json.dumps(doc)))
            self.assertLessEqual(used, set(bc.TOKENS), platform)

    def test_referenced_assets_exist(self):
        for platform, move, doc in self.docs():
            for text in walk_strings(doc):
                if text.startswith("{{ASSETS}}/"):
                    self.assertTrue((ROOT / "payload" / "assets" / text.split("/", 1)[1]).is_file(), text)

    def test_transitions_and_overrides(self):
        for platform, move, doc in self.docs():
            names = {t["name"] for t in doc["transitions"]}
            self.assertEqual("dc Move" in names, move)
            self.assertIn(doc["current_transition"], names)
            overrides = {s["private_settings"]["transition"] for s in doc["sources"] if s["private_settings"].get("transition")}
            self.assertLessEqual(overrides - {"Fade", "Cut"}, names)  # eingebaute Übergänge stehen nicht in der Liste
            self.assertEqual(overrides, {"dc Move", "Fade"} if move else {"dc Slide", "Fade"})

    def test_partner_badge_is_off_by_default(self):
        """Partner-Schild nur auf Abruf: ausgeschaltet; Laufband standardmäßig an; beides in allen Kamera- und Titelszenen."""
        doc = bc.build("macos", False)
        by_name = {s["name"]: s for s in doc["sources"]}
        items = by_name["_Partner"]["settings"]["items"]
        self.assertEqual([i["name"] for i in items], ["_Partner Inhalt"])
        self.assertFalse(items[0]["visible"], "Partner-Schild darf nicht standardmäßig sichtbar sein")
        self.assertTrue(by_name["_Ticker"]["settings"]["items"][0]["visible"])
        for name in ("_Partner", "_Ticker"):
            users = [s["name"] for s in doc["sources"] if s["id"] == "scene"
                     and any(i["name"] == name for i in s["settings"]["items"])]
            self.assertGreaterEqual(len(users), 9, name)

    def test_web_overlays(self):
        """Alerts und Chat sind Browserquellen mit lokalen Seiten (nicht im Linux-Testsystem ohne Browser)."""
        for platform in ("macos", "windows"):
            doc = bc.build(platform, False)
            web = {s["name"]: s for s in doc["sources"] if s["id"] == "browser_source"}
            self.assertEqual(set(web), {"Web Alerts", "Web Chat", "Web Countdown Start", "Web Countdown BRB"})
            for src in web.values():
                self.assertTrue(src["settings"]["is_local_file"])
                self.assertTrue(src["settings"]["local_file"].endswith(".html"))
        self.assertFalse([s for s in bc.build("linux", False)["sources"] if s["id"] == "browser_source"])

    def test_scene_hotkeys_unique(self):
        doc = bc.build("macos", False)
        combos = []
        for source in doc["sources"] + [doc["AuxAudioDevice1"], doc["DesktopAudioDevice1"]]:
            for entries in source["hotkeys"].values():
                combos += [e["key"] for e in entries]
        self.assertEqual(len(combos), len(set(combos)), "Hotkey doppelt belegt")

    def test_committed_payload_is_current(self):
        """Wer brand.json oder den Generator ändert, muss 'python3 tools/build.py' ausführen."""
        for platform in ("macos", "windows"):
            for move in (False, True):
                path = ROOT / "payload" / "scenes" / f"{bc.BRAND['collection']}.{platform}{'.move' if move else ''}.json"
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), bc.build(platform, move), path.name)

    def test_payload_is_small(self):
        total = sum(f.stat().st_size for f in (ROOT / "payload").rglob("*") if f.is_file())
        self.assertLess(total, 10 * 1024 * 1024, "Paket soll klein bleiben")


if __name__ == "__main__":
    unittest.main()
