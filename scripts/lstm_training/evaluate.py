#!/usr/bin/env python3
"""
Model Evaluation & Confusion Matrix Script

Loads the trained CNN-LSTM model and test split, generates:
- Per-class precision, recall, F1
- Confusion matrix (text-based)
- Most confused sign pairs
- Dataset quality summary

Usage:
    python evaluate.py --data ./data/processed --model ./models/run_29signs_20260215_190544/run_cnn_lstm_20260215_190549/best_model.keras
    python evaluate.py --data ./data/processed  # auto-finds latest model
"""

import argparse
import json
import os
from pathlib import Path
from typing import List, Dict, Tuple
import numpy as np


def load_test_data(data_dir: Path) -> Tuple[np.ndarray, np.ndarray, dict]:
    """Load test split and metadata."""
    X_test = np.load(data_dir / 'X_test.npy')
    y_test = np.load(data_dir / 'y_test.npy')

    with open(data_dir / 'metadata.json', 'r') as f:
        metadata = json.load(f)

    return X_test, y_test, metadata


def find_latest_model(models_dir: Path) -> Path:
    """Find the latest best_model.keras in the models directory."""
    candidates = list(models_dir.rglob('best_model.keras'))
    if not candidates:
        raise FileNotFoundError(f"No best_model.keras found under {models_dir}")
    # Sort by modification time, newest first
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def compute_confusion_matrix(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int) -> np.ndarray:
    """Compute confusion matrix manually (no sklearn dependency)."""
    cm = np.zeros((n_classes, n_classes), dtype=np.int32)
    for t, p in zip(y_true, y_pred):
        cm[int(t)][int(p)] += 1
    return cm


def compute_metrics(cm: np.ndarray, vocabulary: List[str]) -> List[Dict]:
    """Compute per-class precision, recall, F1 from confusion matrix."""
    metrics = []
    for i, sign in enumerate(vocabulary):
        tp = cm[i][i]
        fp = cm[:, i].sum() - tp  # other classes predicted as this
        fn = cm[i, :].sum() - tp  # this class predicted as other

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
        support = int(cm[i, :].sum())

        metrics.append({
            'sign': sign,
            'precision': round(precision, 4),
            'recall': round(recall, 4),
            'f1': round(f1, 4),
            'support': support,
            'correct': int(tp),
        })

    return metrics


def find_confused_pairs(cm: np.ndarray, vocabulary: List[str], top_k: int = 10) -> List[Dict]:
    """Find the most confused sign pairs (off-diagonal errors)."""
    pairs = []
    n = len(vocabulary)
    for i in range(n):
        for j in range(n):
            if i != j and cm[i][j] > 0:
                pairs.append({
                    'true': vocabulary[i],
                    'predicted': vocabulary[j],
                    'count': int(cm[i][j]),
                    'pct_of_true': round(cm[i][j] / max(cm[i, :].sum(), 1) * 100, 1),
                })

    pairs.sort(key=lambda x: x['count'], reverse=True)
    return pairs[:top_k]


def print_confusion_matrix(cm: np.ndarray, vocabulary: List[str]) -> None:
    """Print a formatted confusion matrix."""
    # Abbreviate long sign names for display
    abbrevs = [s[:6] for s in vocabulary]

    print("\n" + "=" * 80)
    print("CONFUSION MATRIX")
    print("=" * 80)
    print(f"{'':>8}", end='')
    for a in abbrevs:
        print(f"{a:>7}", end='')
    print()

    for i, sign in enumerate(vocabulary):
        print(f"{abbrevs[i]:>8}", end='')
        for j in range(len(vocabulary)):
            val = cm[i][j]
            if val == 0:
                print(f"{'·':>7}", end='')
            elif i == j:
                print(f"\033[92m{val:>7}\033[0m", end='')  # Green for correct
            else:
                print(f"\033[91m{val:>7}\033[0m", end='')  # Red for errors
        total = cm[i, :].sum()
        acc = cm[i][i] / total * 100 if total > 0 else 0
        print(f"  | {acc:5.1f}% ({total} samples)")

    print()


def print_metrics(metrics: List[Dict]) -> None:
    """Print per-class metrics table."""
    print("\n" + "=" * 80)
    print("PER-CLASS METRICS")
    print("=" * 80)
    print(f"{'Sign':<14} {'Prec':>6} {'Recall':>7} {'F1':>6} {'Support':>8} {'Status'}")
    print("-" * 60)

    for m in sorted(metrics, key=lambda x: x['f1']):
        status = ""
        if m['f1'] < 0.3:
            status = "❌ CRITICAL"
        elif m['f1'] < 0.5:
            status = "⚠️  WEAK"
        elif m['f1'] < 0.7:
            status = "⚡ MODERATE"
        else:
            status = "✅ GOOD"

        print(f"{m['sign']:<14} {m['precision']:>6.2f} {m['recall']:>7.2f} {m['f1']:>6.2f} {m['support']:>8}  {status}")


def print_confused_pairs(pairs: List[Dict]) -> None:
    """Print most confused sign pairs."""
    print("\n" + "=" * 80)
    print("MOST CONFUSED PAIRS")
    print("=" * 80)
    print(f"{'True Sign':<14} {'Predicted As':<14} {'Count':>6} {'% of True':>10}")
    print("-" * 50)

    for p in pairs:
        print(f"{p['true']:<14} {p['predicted']:<14} {p['count']:>6} {p['pct_of_true']:>9.1f}%")


def print_summary(metrics: List[Dict], cm: np.ndarray, vocabulary: List[str]) -> None:
    """Print overall summary and recommendations.

    Classification thresholds (by F1 score):
      - signs_to_prune : F1 < 0.3   — too inaccurate, remove from LSTM vocab
      - signs_weak     : 0.3 ≤ F1 < 0.5 — needs significantly more data
      - signs_moderate : 0.5 ≤ F1 < 0.7 — usable but needs improvement
      - signs_good     : F1 ≥ 0.7   — reliable for LSTM short-circuit
    """
    total_correct = sum(cm[i][i] for i in range(len(vocabulary)))
    total_samples = cm.sum()
    overall_acc = total_correct / total_samples * 100 if total_samples > 0 else 0

    critical = [m for m in metrics if m['f1'] < 0.3]
    weak = [m for m in metrics if 0.3 <= m['f1'] < 0.5]
    moderate = [m for m in metrics if 0.5 <= m['f1'] < 0.7]
    good = [m for m in metrics if m['f1'] >= 0.7]

    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Overall test accuracy: {overall_acc:.1f}% ({total_correct}/{total_samples})")
    print(f"Vocabulary size: {len(vocabulary)} signs")
    print(f"Good signs (F1≥0.7): {len(good)}")
    print(f"Moderate signs (F1 0.5-0.7): {len(moderate)}")
    print(f"Weak signs (F1 0.3-0.5): {len(weak)}")
    print(f"Critical signs (F1<0.3): {len(critical)}")
    categorized = len(critical) + len(weak) + len(moderate) + len(good)
    assert categorized == len(vocabulary), f"Categorized {categorized} != vocabulary {len(vocabulary)}"

    if critical:
        print(f"\nSigns to PRUNE (F1<0.3): {', '.join(m['sign'] for m in critical)}")
    if weak:
        print(f"Signs needing more data (F1 0.3-0.5): {', '.join(m['sign'] for m in weak)}")
    if moderate:
        print(f"Moderate signs to improve (F1 0.5-0.7): {', '.join(m['sign'] for m in moderate)}")

    print(f"\nRecommended vocabulary after pruning: {len(vocabulary) - len(critical)} signs")
    print(f"Expected accuracy improvement: pruning removes {sum(m['support'] - m['correct'] for m in critical)} errors from test set")


def save_report(output_path: Path, metrics: List[Dict], pairs: List[Dict],
                cm: np.ndarray, vocabulary: List[str]) -> None:
    """Save evaluation report as JSON."""
    total_correct = sum(cm[i][i] for i in range(len(vocabulary)))
    total_samples = int(cm.sum())

    # Classification thresholds (by F1 score):
    #   signs_to_prune : F1 < 0.3   — too inaccurate, remove from LSTM vocab
    #   signs_weak     : 0.3 ≤ F1 < 0.5 — needs significantly more data
    #   signs_moderate : 0.5 ≤ F1 < 0.7 — usable but needs improvement
    #   signs_good     : F1 ≥ 0.7   — reliable for LSTM short-circuit
    signs_to_prune = [m['sign'] for m in metrics if m['f1'] < 0.3]
    signs_weak = [m['sign'] for m in metrics if 0.3 <= m['f1'] < 0.5]
    signs_moderate = [m['sign'] for m in metrics if 0.5 <= m['f1'] < 0.7]
    signs_good = [m['sign'] for m in metrics if m['f1'] >= 0.7]

    categorized = len(signs_to_prune) + len(signs_weak) + len(signs_moderate) + len(signs_good)
    assert categorized == len(vocabulary), (
        f"Categorized {categorized} signs != vocabulary_size {len(vocabulary)}; "
        "check that F1 threshold buckets are exhaustive"
    )

    report = {
        'overall_accuracy': round(total_correct / total_samples, 4) if total_samples > 0 else 0,
        'total_samples': total_samples,
        'vocabulary_size': len(vocabulary),
        'per_class_metrics': metrics,
        'confused_pairs': pairs,
        'confusion_matrix': cm.tolist(),
        'signs_to_prune': signs_to_prune,
        'signs_weak': signs_weak,
        'signs_moderate': signs_moderate,
        'signs_good': signs_good,
    }

    with open(output_path, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\nReport saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description='Evaluate CNN-LSTM model quality')
    parser.add_argument('--data', type=str, default='./data/processed',
                        help='Directory with preprocessed test data')
    parser.add_argument('--model', type=str, default=None,
                        help='Path to best_model.keras (auto-finds latest if omitted)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output path for JSON report (default: evaluation_report.json)')
    args = parser.parse_args()

    data_dir = Path(args.data)
    if not data_dir.exists():
        print(f"Error: Data directory not found: {data_dir}")
        return

    # Load test data
    print("Loading test data...")
    X_test, y_test, metadata = load_test_data(data_dir)
    vocabulary = metadata['vocabulary']
    n_classes = len(vocabulary)

    print(f"Test samples: {len(X_test)}")
    print(f"Vocabulary: {n_classes} signs")

    # Load model
    if args.model:
        model_path = Path(args.model)
    else:
        models_dir = Path('./models')
        model_path = find_latest_model(models_dir)

    print(f"Loading model: {model_path}")

    import tensorflow as tf
    from model import AttentionLayer

    model = tf.keras.models.load_model(
        model_path,
        custom_objects={'AttentionLayer': AttentionLayer},
    )

    # Run predictions
    print("Running inference on test set...")
    y_pred_probs = model.predict(X_test, verbose=0)
    y_pred = np.argmax(y_pred_probs, axis=1)

    # Compute confusion matrix
    cm = compute_confusion_matrix(y_test, y_pred, n_classes)

    # Compute metrics
    metrics = compute_metrics(cm, vocabulary)
    pairs = find_confused_pairs(cm, vocabulary, top_k=15)

    # Print results
    print_confusion_matrix(cm, vocabulary)
    print_metrics(metrics)
    print_confused_pairs(pairs)
    print_summary(metrics, cm, vocabulary)

    # Save report
    output_path = Path(args.output) if args.output else Path('evaluation_report.json')
    save_report(output_path, metrics, pairs, cm, vocabulary)


if __name__ == '__main__':
    main()
