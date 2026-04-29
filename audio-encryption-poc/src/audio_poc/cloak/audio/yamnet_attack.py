"""Targeted PGD attack on YAMNet (audio event classifier).

YAMNet works at the *sound type* level (Speech / Music / Whistling / etc.),
not at the topic level, so this is mainly demonstrative. Use it to show that
the same waveform can be classified differently across the AudioSet ontology.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlretrieve

import numpy as np


YAMNET_HUB_URL = "https://tfhub.dev/google/yamnet/1"
_YAMNET_CLASSES_URL = (
    "https://raw.githubusercontent.com/tensorflow/models/master/research/"
    "audioset/yamnet/yamnet_class_map.csv"
)


@dataclass
class YamnetAttackResult:
    audio_mono: np.ndarray
    sample_rate: int
    target_class: str
    target_class_index: int
    final_score: float
    final_topk: list[tuple[str, float]]
    iterations: int
    epsilon: float


def _load_class_map(workdir: Path) -> dict[int, str]:
    workdir.mkdir(parents=True, exist_ok=True)
    path = workdir / "yamnet_class_map.csv"
    if not path.exists():
        urlretrieve(_YAMNET_CLASSES_URL, str(path))
    mapping: dict[int, str] = {}
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            mapping[int(row["index"])] = row["display_name"]
    return mapping


def _ensure_tf():
    try:
        import tensorflow as tf
        import tensorflow_hub as hub
    except ImportError as exc:
        raise RuntimeError(
            "YAMNet attack requer tensorflow + tensorflow-hub. "
            "Rode: pip install tensorflow tensorflow-hub"
        ) from exc
    return tf, hub


def cloak_to_yamnet_class(
    audio_np: np.ndarray,
    sample_rate: int,
    target_class: str,
    workdir: str | Path,
    epsilon: float = 0.01,
    lr: float = 1e-3,
    iters: int = 600,
    progress_callback=None,
) -> YamnetAttackResult:
    tf, hub = _ensure_tf()

    if audio_np.ndim == 2:
        audio_np = audio_np.mean(axis=1)
    audio_np = audio_np.astype(np.float32)

    if sample_rate != 16000:
        from scipy import signal as sp_signal
        n_new = int(audio_np.shape[0] * 16000 / sample_rate)
        audio_np = sp_signal.resample(audio_np, n_new).astype(np.float32)
        sample_rate = 16000

    work = Path(workdir)
    class_map = _load_class_map(work)
    inverted = {v.lower(): k for k, v in class_map.items()}
    if target_class.lower() not in inverted:
        raise ValueError(
            f"Classe YAMNet desconhecida: {target_class!r}. "
            f"Exemplos: Music, Whistling, Bird, Vehicle, Wind."
        )
    target_idx = inverted[target_class.lower()]

    yamnet = hub.load(YAMNET_HUB_URL)

    audio_var = tf.Variable(audio_np, dtype=tf.float32)
    delta = tf.Variable(tf.zeros_like(audio_var), dtype=tf.float32)
    optimizer = tf.keras.optimizers.Adam(learning_rate=lr)

    last_score = 0.0
    for step in range(iters):
        with tf.GradientTape() as tape:
            x = tf.clip_by_value(audio_var + delta, -1.0, 1.0)
            scores, _embeds, _spec = yamnet(x)
            avg_scores = tf.reduce_mean(scores, axis=0)
            target_score = avg_scores[target_idx]
            loss = -tf.math.log(target_score + 1e-8)
        grads = tape.gradient(loss, [delta])
        optimizer.apply_gradients(zip(grads, [delta]))
        delta.assign(tf.clip_by_value(delta, -epsilon, epsilon))
        last_score = float(target_score.numpy())
        if progress_callback and step % 50 == 0:
            progress_callback(step, iters, last_score)

    adv = tf.clip_by_value(audio_var + delta, -1.0, 1.0).numpy().astype(np.float32)
    scores_final, _, _ = yamnet(adv)
    avg = tf.reduce_mean(scores_final, axis=0).numpy()
    topk_idx = np.argsort(-avg)[:5]
    topk = [(class_map[int(i)], float(avg[i])) for i in topk_idx]

    return YamnetAttackResult(
        audio_mono=adv,
        sample_rate=sample_rate,
        target_class=target_class,
        target_class_index=target_idx,
        final_score=last_score,
        final_topk=topk,
        iterations=iters,
        epsilon=epsilon,
    )
