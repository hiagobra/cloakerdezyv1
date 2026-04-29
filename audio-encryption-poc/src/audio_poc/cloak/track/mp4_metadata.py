"""Write iTunes-style MP4 metadata atoms.

Multimodal moderators sometimes consult container metadata (title / description /
keywords) when describing a clip, especially in low-confidence scenarios.
Setting these atoms to the target topic is essentially free entropy in our
favor.
"""

from __future__ import annotations

from pathlib import Path

from ..targets import TopicTarget


_FREEFORM_KEYS = {
    "title": "\xa9nam",
    "artist": "\xa9ART",
    "album": "\xa9alb",
    "comment": "\xa9cmt",
    "description": "desc",
    "keywords": "keyw",
    "genre": "\xa9gen",
    "year": "\xa9day",
}


def write_mp4_metadata(video_path: str | Path, metadata: dict[str, str]) -> dict[str, str]:
    """Write atoms in-place. Silently no-ops on unsupported containers."""
    try:
        from mutagen.mp4 import MP4, MP4MetadataError
    except ImportError as exc:
        raise RuntimeError(
            "mutagen não instalado. Rode: pip install mutagen"
        ) from exc

    p = Path(video_path)
    if not p.exists():
        raise FileNotFoundError(p)

    try:
        f = MP4(str(p))
    except MP4MetadataError as exc:
        raise RuntimeError(
            f"Container não suporta atoms iTunes ({p.suffix}). "
            "Use saída .mp4/.m4v."
        ) from exc

    written: dict[str, str] = {}
    for human, value in metadata.items():
        atom = _FREEFORM_KEYS.get(human)
        if atom is None or not value:
            continue
        f[atom] = [str(value)]
        written[human] = str(value)
    f.save()
    return written


def write_mp4_metadata_for_target(video_path: str | Path, target: TopicTarget) -> dict[str, str]:
    return write_mp4_metadata(video_path, target.mp4_metadata)
