# Feedback Best Practices Guide

This guide helps you provide high-quality feedback that maximizes the data Gemini needs to improve ASL translation accuracy.

---

## Why Your Feedback Matters

Every time you rate a translation, you're teaching the system:
- **👍 Positive feedback** confirms Gemini interpreted your sign correctly
- **👎 Negative feedback + correction** teaches Gemini what it should have recognized

The more specific and consistent your feedback, the faster accuracy improves.

---

## How to Provide Quality Feedback

### ✅ DO: Be Specific with Corrections

When you click 👎, always provide the **exact ASL gloss** you intended:

| Gemini Said | Your Correction | Quality |
|-------------|-----------------|---------|
| HELLO | HI | ✅ Good - specific alternative |
| THANK | THANK-YOU | ✅ Good - correct full sign |
| UNKNOWN | BATHROOM | ✅ Good - identifies missed sign |

### ✅ DO: Use Standard Gloss Format

- **UPPERCASE** for all signs: `THANK-YOU`, not `thank you`
- **Hyphens** for compound signs: `NICE-TO-MEET-YOU`
- **Single words** when possible: `YES`, `NO`, `PLEASE`

### ✅ DO: Rate Immediately

Rate the translation right after you see it, while you remember exactly what you signed. Don't skip ratings.

### ✅ DO: Be Consistent

If you signed "HI" and Gemini said "HELLO", decide if that's acceptable to you:
- If close enough → 👍
- If you want exact match → 👎 with "HI"

Stay consistent with your choice across sessions.

---

## What NOT to Do

### ❌ DON'T: Provide Vague Corrections

| Gemini Said | Bad Correction | Why It's Bad |
|-------------|----------------|--------------|
| HELLO | wrong | No useful information |
| THANK | it was something else | Can't learn from this |
| YES | ??? | Empty/unclear |

### ❌ DON'T: Skip the Correction Field

Clicking 👎 without providing a correction wastes the feedback. The system needs to know what you actually signed.

### ❌ DON'T: Rate Signs You Didn't Make

Only rate when you actually signed something. If the camera picked up random hand movement, ignore that translation.

### ❌ DON'T: Mix Languages

Corrections should be in ASL gloss format, not spoken English sentences:
- ❌ "I was trying to say thank you"
- ✅ "THANK-YOU"

---

## Tips for Better Recognition

### Signing Tips

1. **Good lighting** - Face a light source, avoid backlit situations
2. **Clear background** - Plain backgrounds help hand detection
3. **Full hand visibility** - Keep hands in frame with fingers visible
4. **Pause at end** - Hold your final hand position for ~1.5 seconds
5. **One sign at a time** - System works best with isolated signs currently

### Common Recognition Issues

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| No detection | Hands not visible | Move closer to camera |
| Wrong sign | Similar hand shape | Hold position longer |
| "UNKNOWN" | Rare sign or poor angle | Try different angle |
| Delayed response | Motion still detected | Hold still after signing |

---

## Understanding the Feedback Loop

```
You sign → Gemini interprets → You rate → Data collected
                                              ↓
                               Patterns analyzed weekly
                                              ↓
                               Prompt updated with corrections
                                              ↓
                               Future accuracy improves
```

### Timeline for Improvements

| Feedback Volume | Expected Impact |
|-----------------|-----------------|
| 20+ ratings | Basic pattern identification |
| 50+ ratings | Reliable accuracy metrics |
| 100+ ratings | Meaningful prompt improvements |
| 500+ ratings | Significant accuracy gains |

---

## Feedback Quality Checklist

Before submitting a correction, verify:

- [ ] I actually signed something (not random movement)
- [ ] My correction is in UPPERCASE gloss format
- [ ] I used hyphens for compound signs
- [ ] The correction matches what I intended to sign
- [ ] I'm being consistent with my previous ratings

---

## Examples of High-Quality Feedback Sessions

### Example 1: Greeting Practice

| You Signed | Gemini Said | Your Action | Result |
|------------|-------------|-------------|--------|
| HELLO | HELLO | 👍 | Confirmed correct |
| HI | HELLO | 👎 → "HI" | Taught distinction |
| THANK-YOU | THANK | 👎 → "THANK-YOU" | Corrected incomplete |
| YES | YES | 👍 | Confirmed correct |

### Example 2: Question Words

| You Signed | Gemini Said | Your Action | Result |
|------------|-------------|-------------|--------|
| WHAT | WHAT | 👍 | Confirmed correct |
| WHERE | WHAT | 👎 → "WHERE" | Important distinction |
| WHO | WHAT | 👎 → "WHO" | Pattern emerging |
| WHY | WHY | 👍 | Confirmed correct |

After this session, the system learns that similar hand positions for question words need better differentiation.

---

## Questions?

If you're unsure about:
- **Gloss format**: Use UPPERCASE, hyphens for compounds
- **Whether to rate**: Only rate intentional signs
- **Acceptable accuracy**: Be consistent with your personal threshold

Your feedback directly improves the app for everyone. Thank you for contributing!
