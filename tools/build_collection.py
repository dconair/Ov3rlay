#!/usr/bin/env python3
"""Erzeugt die OBS-Szenen-Collection (JSON) für macOS und Windows.

Ergebnis: payload/scenes/<collection>.<plattform>[.move].json
Die Dateien enthalten Platzhalter {{TOKEN}}, die der Installer pro Rechner füllt
(Asset-Pfad, Schrift, Kamera-IDs). Die Variante ".move" setzt zusätzlich das
Plugin "Move Transition" voraus.
"""
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = json.loads((ROOT / "brand" / "brand.json").read_text(encoding="utf-8"))
OUT = ROOT / "payload" / "scenes"
PREV_VER = 503316482  # OBS 30.0.2
W, H = 1920, 1080

TOKENS = ["ASSETS", "FONT_FACE", "CAM_IPHONE_ID", "CAM_IPHONE_NAME", "CAM_SONY_ID", "CAM_SONY_NAME"]

# Quellen-IDs und Einstellungen, die sich je Betriebssystem unterscheiden.
# "linux" dient nur den automatischen Tests mit einem echten OBS.
PLATFORMS = {
    "macos": {
        "video": ("av_capture_input", lambda c: {"device": f"{{{{CAM_{c}_ID}}}}", "device_name": f"{{{{CAM_{c}_NAME}}}}"}),
        "display": ("screen_capture", {"type": 0, "show_cursor": True}),
        "mic": ("coreaudio_input_capture", {"device_id": "default"}),
        "desktop": ("sck_audio_capture", {"type": 0}),
    },
    "windows": {
        "video": ("dshow_input", lambda c: {"video_device_id": f"{{{{CAM_{c}_ID}}}}",
                                            "last_video_device_id": f"{{{{CAM_{c}_ID}}}}", "res_type": 0}),
        "display": ("monitor_capture", {"monitor": 0, "capture_cursor": True}),
        "mic": ("wasapi_input_capture", {"device_id": "default"}),
        "desktop": ("wasapi_output_capture", {"device_id": "default"}),
    },
    "linux": {
        "video": ("v4l2_input", lambda c: {"device_id": f"{{{{CAM_{c}_ID}}}}"}),
        "display": ("xshm_input", {"screen": 0, "show_cursor": True}),
        "mic": ("pulse_input_capture", {"device_id": "default"}),
        "desktop": ("pulse_output_capture", {"device_id": "default"}),
    },
}

# Bounds-Typen von OBS
BOUNDS_INNER, BOUNDS_OUTER = 2, 3
ALIGN_CENTER, ALIGN_TOPLEFT = 0, 5

SELECT_SCENE_KEYS = ["OBS_KEY_1", "OBS_KEY_2", "OBS_KEY_3", "OBS_KEY_4",
                     "OBS_KEY_5", "OBS_KEY_6", "OBS_KEY_7", "OBS_KEY_8"]
HOTKEY_MODS = {"control": True, "alt": True}  # Strg+Alt bzw. Ctrl+Option


def hotkey(key):
    return [{"key": key, **HOTKEY_MODS}]


def abgr(hex_color):
    """'#RRGGBB' -> OBS-Farbwert (ABGR, voll deckend)."""
    r, g, b = (int(hex_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    return 0xFF000000 | (b << 16) | (g << 8) | r


class Collection:
    def __init__(self, platform, move):
        self.platform, self.move = platform, move
        self.p = PLATFORMS[platform]
        self.sources = {}
        self.scenes = {}
        self.colors = {k: abgr(v) for k, v in BRAND["colors"].items()}

    # -- Grundbausteine --
    def uid(self, name):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{BRAND['collection']}/{self.platform}/{name}"))

    def make_source(self, sid, name, settings=None, filters=None, audio=False, hotkeys=None, private=None):
        src = {
            "prev_ver": PREV_VER, "name": name, "uuid": self.uid(name), "id": sid, "versioned_id": sid,
            "settings": settings or {}, "mixers": 255 if audio else 0, "sync": 0, "flags": 0,
            "volume": 1.0, "balance": 0.5, "enabled": True, "muted": False,
            "push-to-mute": False, "push-to-mute-delay": 0, "push-to-talk": False, "push-to-talk-delay": 0,
            "hotkeys": hotkeys or {}, "deinterlace_mode": 0, "deinterlace_field_order": 0,
            "monitoring_type": 0, "private_settings": private or {},
        }
        if filters:
            src["filters"] = [self.make_filter(*f) for f in filters]
        return src

    def make_filter(self, fid, name, settings):
        return {"prev_ver": PREV_VER, "name": name, "uuid": self.uid("filter/" + name), "id": fid,
                "versioned_id": fid, "settings": settings, "mixers": 0, "sync": 0, "flags": 0,
                "volume": 1.0, "balance": 0.5, "enabled": True, "muted": False, "hotkeys": {},
                "private_settings": {}}

    def source(self, sid, name, settings=None, **kw):
        self.sources[name] = self.make_source(sid, name, settings, **kw)
        return name

    def asset(self, rel):
        return "{{ASSETS}}/" + rel

    def image(self, name, rel, **kw):
        return self.source("image_source", name, {"file": self.asset(rel), "unload": False}, **kw)

    def text(self, name, text, size, color="light", bold=True):
        font = {"face": "{{FONT_FACE}}", "size": size, "flags": 1 if bold else 0, "style": "Bold" if bold else "Regular"}
        return self.source("text_ft2_source_v2", name, {
            "text": text, "font": font, "color1": self.colors[color], "color2": self.colors[color],
            "drop_shadow": True, "outline": False, "word_wrap": False})

    def scene(self, name, hotkey_key=None, transition=None):
        scene = Scene(self, name)
        scene.hotkey_key, scene.transition = hotkey_key, transition
        self.scenes[name] = scene
        return scene

    # -- Gesamtdokument --
    def build(self):
        self.define_sources()
        self.define_scenes()
        audio = {"DesktopAudioDevice1": self.sources.pop("Desktop Audio"),
                 "AuxAudioDevice1": self.sources.pop("Mic/Aux")}
        sources = list(self.sources.values()) + [s.as_source() for s in self.scenes.values()]
        public = [n for n in self.scenes if not n.startswith("_")]
        order = public + [n for n in self.scenes if n.startswith("_")]
        doc = {
            "current_scene": public[0], "current_program_scene": public[0],
            "scene_order": [{"name": n} for n in order],
            "name": BRAND["collection"],
            "sources": sources, "groups": [],
            "quick_transitions": self.quick_transitions(),
            "transitions": self.transitions(),
            "saved_projectors": [],
            "current_transition": "dc Stinger", "transition_duration": 300,
            "preview_locked": False, "scaling_enabled": False, "scaling_level": 0,
            "scaling_off_x": 0.0, "scaling_off_y": 0.0,
            "modules": {"scripts-tool": []},
            **audio,
        }
        return doc

    def transitions(self):
        t = [
            {"name": "dc Stinger", "id": "obs_stinger_transition", "settings": {
                "path": self.asset("video/stinger.webm"), "tp_type": 0, "transition_point": 520,
                "audio_fade_style": 0, "audio_monitoring": 0}},
            {"name": "dc Slide", "id": "slide_transition", "settings": {"direction": "left"}},
            {"name": "dc Swipe", "id": "swipe_transition", "settings": {"direction": "left"}},
            {"name": "dc Fade Black", "id": "fade_to_color_transition", "settings": {"color": 0xFF000000}},
        ]
        if self.move:
            t.append({"name": "dc Move", "id": "move_transition", "settings": {}})
        return t

    def quick_transitions(self):
        names = ["Cut", "Fade", "dc Stinger", "dc Slide", "dc Fade Black"]
        return [{"name": n, "duration": 300, "hotkeys": [], "id": i + 1, "fade_to_black": False}
                for i, n in enumerate(names)]

    # -- Inhalt --
    def define_sources(self):
        c, t = self.colors, BRAND["texts"]
        # Medien und Grafiken
        self.source("ffmpeg_source", "BG Loop", {
            "local_file": self.asset("video/bg_loop.mp4"), "is_local_file": True, "looping": True,
            "close_when_inactive": False, "restart_on_activate": False, "hw_decode": False})
        self.image("Logo", "branding/logo.png")
        self.image("Frame Cam", "overlays/frame_cam.png")
        self.image("Lower Third Plate", "overlays/lower_third.png")
        self.image("Band Stripes", "overlays/band_stripes.png", filters=[
            ("scroll_filter", "Scroll", {"speed_x": 90.0, "speed_y": 0.0, "loop": True, "limit_cx": False,
                                         "limit_cy": False})])
        # Kameras: je Quelle eine Platzhalterkarte darunter, falls das Gerät fehlt
        vid_id, vid_cfg = self.p["video"]
        for cam in BRAND["cameras"]:
            key = cam["id"].upper()
            self.image(f"Cam Offline {cam['label']}", f"overlays/cam_offline_{cam['id']}.png")
            self.source(vid_id, f"CAM {cam['label']}", vid_cfg(key), filters=[
                ("color_filter_v2", "Farbkorrektur", {"contrast": 0.06, "saturation": 0.08, "gamma": 0.0}),
                ("sharpness_filter_v2", "Schärfe", {"sharpness": 0.08})])
        self.source(self.p["display"][0], "Screen", self.p["display"][1])
        # Audio: Desktop und Mikrofon mit Standard-Filterkette
        self.source(self.p["desktop"][0], "Desktop Audio", self.p["desktop"][1], audio=True,
                    hotkeys={"libobs.mute": hotkey("OBS_KEY_D"), "libobs.unmute": []})
        self.source(self.p["mic"][0], "Mic/Aux", self.p["mic"][1], audio=True,
                    hotkeys={"libobs.mute": hotkey("OBS_KEY_M"), "libobs.unmute": []},
                    filters=[
                        ("noise_suppress_filter_v2", "Rauschunterdrückung", {"method": "rnnoise"}),
                        ("gain_filter", "Verstärkung", {"db": 0.0}),
                        ("compressor_filter", "Kompressor", {"ratio": 4.0, "threshold": -18.0, "attack_time": 6.0,
                                                             "release_time": 60.0, "output_gain": 0.0}),
                        ("limiter_filter", "Limiter", {"threshold": -3.0, "release_time": 60.0})])
        # Texte
        for key, label in (("starting", "Starting"), ("brb", "BRB"), ("ending", "Ending")):
            self.text(f"Txt {label}", t[key][0], 96)
            self.text(f"Txt {label} Sub", t[key][1], 40, bold=False)
        self.text("Txt Handle", BRAND["handle"], 38, color="primary")
        self.text("Txt LT Name", t["lower_third"][0], 64)
        self.text("Txt LT Title", t["lower_third"][1], 34, bold=False)

    def define_scenes(self):
        move_or_slide = ("dc Move", 600) if self.move else ("dc Slide", 450)
        cam_iphone, cam_sony = "CAM iPhone", "CAM Sony A7 II"
        off_iphone, off_sony = "Cam Offline iPhone", "Cam Offline Sony A7 II"

        # Wiederverwendbare Bausteine (Unterstrich = Hilfsszene)
        lt = self.scene("_Lower Third Inhalt")
        lt.add("Lower Third Plate", (0, 0))
        lt.add("Txt LT Name", (110, 18))
        lt.add("Txt LT Title", (112, 98))
        bug = self.scene("_Branding Bug")
        bug.add("Logo", (1760, 40), scale=0.12)
        lower = self.scene("_Lower Third")
        lower.add("_Lower Third Inhalt", (80, 800), visible=False, show=("slide_transition", {"direction": "left"}),
                  hide=("slide_transition", {"direction": "right"}), hotkeys=("OBS_KEY_L", "OBS_KEY_H"))

        def cam(scene, label_off, label_cam, pos, size, frame=False, bounds=BOUNDS_INNER):
            scene.add(label_off, pos, bounds=size, bounds_type=bounds)
            scene.add(label_cam, pos, bounds=size, bounds_type=bounds)
            if frame:
                scene.add("Frame Cam", pos, bounds=size, bounds_type=BOUNDS_INNER)

        def title_card(scene, label):
            scene.add("BG Loop", (0, 0), bounds=(W, H), bounds_type=BOUNDS_OUTER)
            scene.add("Band Stripes", (0, H - 40))
            scene.add("Logo", (960, 360), scale=0.42, align=ALIGN_CENTER)
            scene.add(f"Txt {label}", (960, 700), align=ALIGN_CENTER)
            scene.add(f"Txt {label} Sub", (960, 800), align=ALIGN_CENTER)
            scene.add("Txt Handle", (960, 960), align=ALIGN_CENTER)

        title_card(self.scene("01 Starting Soon", "OBS_KEY_1"), "Starting")

        s = self.scene("02 Kamera iPhone", "OBS_KEY_2", move_or_slide)
        cam(s, off_iphone, cam_iphone, (0, 0), (W, H))
        s.add("_Branding Bug", (0, 0)); s.add("_Lower Third", (0, 0))

        s = self.scene("03 Kamera Sony", "OBS_KEY_3", move_or_slide)
        cam(s, off_sony, cam_sony, (0, 0), (W, H))
        s.add("_Branding Bug", (0, 0)); s.add("_Lower Third", (0, 0))

        s = self.scene("04 Dual Cam", "OBS_KEY_4", move_or_slide)
        s.add("BG Loop", (0, 0), bounds=(W, H), bounds_type=BOUNDS_OUTER)
        cam(s, off_iphone, cam_iphone, (50, 290), (880, 495), frame=True)
        cam(s, off_sony, cam_sony, (990, 290), (880, 495), frame=True)
        s.add("Logo", (960, 120), scale=0.16, align=ALIGN_CENTER)
        s.add("Band Stripes", (0, H - 40))
        s.add("_Lower Third", (0, 0))

        s = self.scene("05 Screen + Cam", "OBS_KEY_5", move_or_slide)
        s.add("Screen", (0, 0), bounds=(W, H), bounds_type=BOUNDS_INNER)
        cam(s, off_sony, cam_sony, (1330, 745), (540, 304), frame=True)
        s.add("_Branding Bug", (0, 0)); s.add("_Lower Third", (0, 0))

        s = self.scene("06 Screen Only", "OBS_KEY_6", move_or_slide)
        s.add("Screen", (0, 0), bounds=(W, H), bounds_type=BOUNDS_INNER)
        s.add("_Branding Bug", (0, 0))

        title_card(self.scene("07 BRB", "OBS_KEY_7"), "BRB")
        title_card(self.scene("08 Ending", "OBS_KEY_8"), "Ending")


class Scene:
    def __init__(self, coll, name):
        self.coll, self.name, self.items = coll, name, []
        self.hotkey_key, self.transition = None, None
        self.item_hotkeys = {}

    def add(self, source, pos, scale=1.0, align=ALIGN_TOPLEFT, bounds=None, bounds_type=0, visible=True,
            show=None, hide=None, hotkeys=None):
        if source not in self.coll.sources and source not in self.coll.scenes:
            raise KeyError(f"Unbekannte Quelle: {source}")
        item = {
            "name": source, "source_uuid": self.coll.uid(source), "visible": visible, "locked": False, "rot": 0.0,
            "pos": {"x": float(pos[0]), "y": float(pos[1])}, "scale": {"x": scale, "y": scale}, "align": align,
            "bounds_type": bounds_type, "bounds_align": 0,
            "bounds": {"x": float(bounds[0]), "y": float(bounds[1])} if bounds else {"x": 0.0, "y": 0.0},
            "crop_left": 0, "crop_top": 0, "crop_right": 0, "crop_bottom": 0,
            "id": len(self.items) + 1, "group_item_backup": False,
            "scale_filter": "disable", "blend_method": "default", "blend_type": "normal",
            "private_settings": {},
        }
        for key, spec in (("show_transition", show), ("hide_transition", hide)):
            if spec:
                item[key] = {"name": spec[0], "id": spec[0], "settings": spec[1]}
                item[key + "_duration"] = 400
        if hotkeys:
            self.item_hotkeys = {f"libobs.show_scene_item.{item['id']}": hotkey(hotkeys[0]),
                                 f"libobs.hide_scene_item.{item['id']}": hotkey(hotkeys[1])}
        self.items.append(item)
        return item["id"]

    def as_source(self):
        hotkeys = {"OBSBasic.SelectScene": hotkey(self.hotkey_key) if self.hotkey_key else []}
        hotkeys.update(self.item_hotkeys)
        private = {}
        if self.transition:
            private = {"transition": self.transition[0], "transition_duration": self.transition[1]}
        return self.coll.make_source("scene", self.name, {
            "id_counter": len(self.items), "custom_size": False, "items": self.items},
            hotkeys=hotkeys, private=private)


def build(platform, move):
    return Collection(platform, move).build()


def write_all():
    OUT.mkdir(parents=True, exist_ok=True)
    (ROOT / "payload" / "brand.env").write_text(
        f"COLLECTION={BRAND['collection']}\nNAME={BRAND['name']}\nFONT_FAMILY={BRAND['font']['family']}\n",
        encoding="utf-8")
    for platform in ("macos", "windows"):
        for move in (False, True):
            name = f"{BRAND['collection']}.{platform}{'.move' if move else ''}.json"
            (OUT / name).write_text(json.dumps(build(platform, move), indent=1, ensure_ascii=False) + "\n",
                                    encoding="utf-8")
            print("geschrieben:", OUT / name)


if __name__ == "__main__":
    write_all()
