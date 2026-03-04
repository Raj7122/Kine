/**
 * k6 Load Test: Sign Recognition API
 *
 * Run with: k6 run load-tests/sign-recognize-load.js
 * Requires: k6 installed (brew install k6) and local dev server running
 *
 * Scenarios:
 *   - load:   50 req/s sustained for 2 minutes
 *   - stress: ramp to 200 req/s, find breaking point
 *   - spike:  0→500 req/s instant burst
 *   - soak:   20 req/s for 10 minutes (memory leak detection)
 *
 * SAFETY: All tests target localhost:3000 only.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Custom metrics
const errorRate = new Rate('errors');
const predictionLatency = new Trend('prediction_latency');

// --- Payloads ---

function makeSignRecognizePayload() {
  const frames = [];
  for (let i = 0; i < 16; i++) {
    const landmarks = {};
    landmarks.timestamp = Date.now() - (16 - i) * 100;
    landmarks.leftHand = Array.from({ length: 21 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
    }));
    frames.push(landmarks);
  }

  return JSON.stringify({
    frames,
    videoFrames: [],
    sessionId: `k6-load-test-${Date.now()}`,
  });
}

function makeLSTMPredictPayload() {
  const landmarks = [];
  for (let i = 0; i < 16; i++) {
    const frame = Array.from({ length: 63 }, () => Math.random() * 0.5);
    landmarks.push(frame);
  }
  return JSON.stringify({ landmarks });
}

// --- Scenario Selection ---

const SCENARIO = __ENV.SCENARIO || 'load';

const scenarios = {
  load: {
    executor: 'constant-arrival-rate',
    rate: 50,
    timeUnit: '1s',
    duration: '2m',
    preAllocatedVUs: 60,
    maxVUs: 100,
  },
  stress: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    stages: [
      { duration: '30s', target: 50 },
      { duration: '30s', target: 100 },
      { duration: '30s', target: 200 },
      { duration: '30s', target: 0 },
    ],
    preAllocatedVUs: 100,
    maxVUs: 300,
  },
  spike: {
    executor: 'ramping-arrival-rate',
    startRate: 0,
    timeUnit: '1s',
    stages: [
      { duration: '5s', target: 500 },
      { duration: '30s', target: 500 },
      { duration: '5s', target: 0 },
    ],
    preAllocatedVUs: 200,
    maxVUs: 600,
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: 20,
    timeUnit: '1s',
    duration: '10m',
    preAllocatedVUs: 30,
    maxVUs: 50,
  },
};

export const options = {
  scenarios: {
    [SCENARIO]: scenarios[SCENARIO] || scenarios.load,
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],  // 95th percentile under 5s
    errors: ['rate<0.1'],                // Error rate under 10%
  },
};

// --- Test Function ---

export default function () {
  const target = __ENV.TARGET || 'sign-recognize';

  if (target === 'lstm') {
    const payload = makeLSTMPredictPayload();
    const res = http.post(`${BASE_URL}/api/lstm/predict`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    });

    const success = check(res, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has response body': (r) => r.body && r.body.length > 0,
    });

    errorRate.add(!success);
    predictionLatency.add(res.timings.duration);
  } else {
    const payload = makeSignRecognizePayload();
    const res = http.post(`${BASE_URL}/api/sign-recognize`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    });

    const success = check(res, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has response body': (r) => r.body && r.body.length > 0,
    });

    errorRate.add(!success);
    predictionLatency.add(res.timings.duration);
  }

  sleep(0.1); // Small pause between iterations
}

export function handleSummary(data) {
  const summary = {
    scenario: SCENARIO,
    target: __ENV.TARGET || 'sign-recognize',
    timestamp: new Date().toISOString(),
    metrics: {
      http_reqs: data.metrics.http_reqs?.values?.count || 0,
      http_req_duration_avg: data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 'N/A',
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A',
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 'N/A',
      error_rate: data.metrics.errors?.values?.rate?.toFixed(4) || 'N/A',
      prediction_latency_avg: data.metrics.prediction_latency?.values?.avg?.toFixed(2) || 'N/A',
    },
  };

  return {
    stdout: `\n=== Load Test Summary ===\n${JSON.stringify(summary, null, 2)}\n`,
  };
}
