"""Preset definitions for protection intensity."""

PRESETS = {
    # Extra-subtle DSP path for "medio": shift ASR features with minimal audibility.
    "cloak_subtle": {
        "phase_strength": 0.18,
        "noise_base": 0.002,
        "noise_dynamic": 0.006,
        "noise_low_hz": 1300.0,
        "noise_high_hz": 5200.0,
        "target_peak_dbfs": -1.2,
        "target_rms_dbfs": -20.5,
    },
    "light": {
        "phase_strength": 0.25,
        "noise_base": 0.003,
        "noise_dynamic": 0.009,
        "noise_low_hz": 1200.0,
        "noise_high_hz": 5600.0,
        "target_peak_dbfs": -1.2,
        "target_rms_dbfs": -20.0,
    },
    "balanced": {
        "phase_strength": 0.40,
        "noise_base": 0.005,
        "noise_dynamic": 0.015,
        "noise_low_hz": 1100.0,
        "noise_high_hz": 6200.0,
        "target_peak_dbfs": -1.0,
        "target_rms_dbfs": -19.0,
    },
    "aggressive": {
        "phase_strength": 0.55,
        "noise_base": 0.007,
        "noise_dynamic": 0.022,
        "noise_low_hz": 900.0,
        "noise_high_hz": 7000.0,
        "target_peak_dbfs": -0.8,
        "target_rms_dbfs": -18.0,
    },
}
