# Feedback System Technical Documentation

This document explains how the feedback system works, how data flows through the system, and how it ultimately improves translation accuracy.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ Translation │ →  │   Feedback   │ →  │     Metrics      │   │
│  │   Result    │    │   Buttons    │    │    Dashboard     │   │
│  └─────────────┘    └──────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
│  POST /api/feedback     GET /api/feedback/stats                 │
│  GET /api/feedback      GET /api/feedback/patterns              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SUPABASE DATABASE                          │
│  ┌────────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ translation_feedback│  │ accuracy_metrics │  │   learned    │ │
│  │                    │  │                 │  │ corrections  │ │
│  └────────────────────┘  └─────────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PROMPT IMPROVEMENT                            │
│  Analysis Script  →  Pattern Extraction  →  Prompt Update       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Feedback Submission

When a user rates a translation:

```typescript
// User clicks 👍 or 👎
POST /api/feedback
{
  sessionId: "uuid",           // Links feedback to session
  geminiOutput: "HELLO",       // What Gemini predicted
  rating: "positive|negative", // User's rating
  userCorrection: "HI",        // Only for negative (what it should be)
  landmarkData: {...}          // MediaPipe landmarks (optional)
}
```

### 2. Data Storage

Feedback is stored in `translation_feedback` table:

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| session_id | TEXT | Group feedback by session |
| gemini_output | TEXT | What Gemini predicted |
| rating | ENUM | positive / negative |
| user_correction | TEXT | Correct answer (negative only) |
| landmark_data | JSONB | Hand position data for analysis |
| created_at | TIMESTAMP | When feedback was submitted |

### 3. Automatic Pattern Aggregation

A database trigger automatically updates `learned_corrections`:

```sql
-- Trigger fires on INSERT to translation_feedback
-- If rating = 'negative', upserts to learned_corrections:
{
  gemini_misrecognition: "HELLO",
  correct_sign: "HI",
  occurrence_count: 5,        -- Incremented each time
  first_seen_at: "2024-01-01",
  last_seen_at: "2024-01-15", -- Updated each time
  added_to_prompt: false      -- Tracks if we've fixed it
}
```

### 4. Metrics Calculation

The stats endpoint calculates:

```typescript
GET /api/feedback/stats?period=7d

Response:
{
  totalTranslations: 150,
  positiveRatings: 120,
  negativeRatings: 30,
  accuracyRate: 80.0,           // (120/150) * 100
  trend: "improving"            // Compared to previous 7d
}
```

---

## How Feedback Improves Output

### Step 1: Pattern Identification

After collecting feedback, common misrecognitions emerge:

```
Query: SELECT * FROM learned_corrections 
       WHERE occurrence_count >= 3
       ORDER BY occurrence_count DESC;

Results:
| gemini_misrecognition | correct_sign | count |
|-----------------------|--------------|-------|
| HELLO                 | HI           | 23    |
| THANK                 | THANK-YOU    | 15    |
| YES                   | CORRECT      | 8     |
```

### Step 2: Prompt Engineering

These patterns are added to Gemini's system prompt:

```typescript
// Before (generic prompt)
const prompt = `Interpret these ASL signs...`;

// After (with learned corrections)
const prompt = `Interpret these ASL signs...

LEARNED CORRECTIONS FROM USER FEEDBACK:
- Quick wave motion: prefer "HI" over "HELLO" (23 user corrections)
- Single chest tap: output "THANK-YOU" not "THANK" (15 corrections)
- Distinguish "YES" (fist nod) from "CORRECT" (index point + nod)
`;
```

### Step 3: Few-Shot Examples (Advanced)

For persistent issues, include landmark data:

```typescript
const prompt = `...

EXAMPLE CORRECTION:
Input landmarks: {rightHand: [[0.5, 0.3], [0.52, 0.28], ...]}
Wrong interpretation: "HELLO"
Correct interpretation: "HI"
Key difference: Shorter motion arc, fingers more spread
`;
```

### Step 4: Verification

After prompt updates:
1. Mark patterns as `added_to_prompt = true`
2. Track `post_prompt_occurrences` - are they still happening?
3. If yes, the prompt fix didn't work; try different wording
4. If no, the fix worked; accuracy should improve

---

## Measuring Improvement

### Key Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| **Accuracy Rate** | positive / total × 100 | > 85% |
| **Trend** | current_accuracy - previous_accuracy | Positive |
| **Fix Effectiveness** | patterns_fixed / patterns_attempted | > 70% |
| **Time to Fix** | days from first_seen to added_to_prompt | < 14 days |

### Improvement Timeline

```
Week 1: Collect baseline feedback (50+ ratings)
        → Establish initial accuracy rate

Week 2: Identify top 5 misrecognition patterns
        → Update prompt with corrections

Week 3: Measure post-update accuracy
        → Compare to Week 1 baseline

Week 4+: Iterate on remaining patterns
         → Continuous improvement cycle
```

### Expected Results

| Feedback Volume | Expected Accuracy Gain |
|-----------------|----------------------|
| 0-50 ratings | Baseline established |
| 50-100 ratings | +5-10% (low-hanging fruit) |
| 100-500 ratings | +10-20% (pattern fixes) |
| 500+ ratings | +20-40% (comprehensive tuning) |

---

## Database Schema Details

### translation_feedback

```sql
CREATE TABLE translation_feedback (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  gemini_output TEXT NOT NULL,
  rating TEXT CHECK (rating IN ('positive', 'negative')),
  user_correction TEXT,
  landmark_data JSONB,
  confidence_score DECIMAL(4,3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### learned_corrections

```sql
CREATE TABLE learned_corrections (
  id UUID PRIMARY KEY,
  gemini_misrecognition TEXT NOT NULL,
  correct_sign TEXT NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  added_to_prompt BOOLEAN DEFAULT false,
  added_to_prompt_at TIMESTAMPTZ,
  prompt_version INTEGER,
  post_prompt_occurrences INTEGER DEFAULT 0,
  UNIQUE (gemini_misrecognition, correct_sign)
);
```

### accuracy_metrics

```sql
CREATE TABLE accuracy_metrics (
  id UUID PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  period_type TEXT CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  total_translations INTEGER,
  positive_ratings INTEGER,
  negative_ratings INTEGER,
  accuracy_rate DECIMAL(5,4),
  top_corrections JSONB,
  improvement_from_previous DECIMAL(5,4),
  calculated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Reference

### POST /api/feedback

Submit translation feedback.

**Request:**
```json
{
  "sessionId": "string (required)",
  "geminiOutput": "string (required)",
  "rating": "positive | negative (required)",
  "userCorrection": "string (required if negative)",
  "landmarkData": "object (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "feedbackId": "uuid"
}
```

### GET /api/feedback/stats

Get accuracy metrics for a time period.

**Query params:** `period=7d|30d|all`

**Response:**
```json
{
  "success": true,
  "stats": {
    "period": "7d",
    "totalTranslations": 150,
    "positiveRatings": 120,
    "negativeRatings": 30,
    "accuracyRate": 80.0,
    "trend": "improving"
  }
}
```

### GET /api/feedback/patterns

Get common misrecognition patterns.

**Response:**
```json
{
  "success": true,
  "patterns": [
    {
      "geminiOutput": "HELLO",
      "userCorrection": "HI",
      "occurrenceCount": 23,
      "addedToPrompt": false,
      "lastSeen": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Troubleshooting

### Low Accuracy Despite Feedback

1. Check if prompt updates were applied
2. Verify patterns are being extracted correctly
3. Consider if landmark data quality is sufficient

### Patterns Not Improving

1. The prompt correction may be too vague
2. Signs may be too similar to differentiate
3. May need few-shot examples with landmark data

### Metrics Not Updating

1. Check Supabase connection
2. Verify trigger is active on translation_feedback
3. Check for database errors in logs

---

## Future Enhancements

1. **A/B Testing** - Test prompt variations with different user groups
2. **Automatic Prompt Updates** - Script to generate and apply prompt changes
3. **Landmark Analysis** - ML model to identify distinguishing features
4. **User-specific Learning** - Personalized corrections per signing style
