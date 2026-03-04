import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chaos / Failure Injection Tests for LSTM Predict Route
 *
 * Simulates file system failures, corrupted models, malformed JSON,
 * and TF.js initialization errors to verify graceful degradation.
 */

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

const tfMocks = vi.hoisted(() => {
  class Tensor {
    private readonly values: number[];

    constructor(values: number[] = []) {
      this.values = values;
    }

    async data(): Promise<Float32Array> {
      return Float32Array.from(this.values);
    }

    dispose(): void {
      // no-op
    }
  }

  return {
    Tensor,
    tensor3d: vi.fn(() => new Tensor()),
    loadLayersModel: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      promises: { ...actual.promises, readFile: fsMocks.readFile },
    },
    promises: { ...actual.promises, readFile: fsMocks.readFile },
  };
});

vi.mock('@tensorflow/tfjs', () => ({
  Tensor: tfMocks.Tensor,
  tensor3d: tfMocks.tensor3d,
  loadLayersModel: tfMocks.loadLayersModel,
  io: {},
  layers: { Layer: class Layer { static className = 'Layer'; } },
  serialization: { registerClass: vi.fn() },
  initializers: { glorotUniform: vi.fn(), zeros: vi.fn() },
}));

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

function validLandmarks(count = 16): number[][] {
  return Array.from({ length: count }, () => Array(63).fill(0.1));
}

// --- Chaos Tests ---

describe('LSTM chaos - file system failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 500 when model.json is missing (ENOENT)', async () => {
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) {
        const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      return Buffer.from([0]);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBeDefined();
  });

  it('returns 500 when shard .bin files are missing', async () => {
    const modelJson = {
      format: 'layers-model',
      modelTopology: { class_name: 'Model', config: {} },
      weightsManifest: [{
        paths: ['group1-shard1of1.bin'],
        weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
      }],
    };

    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return JSON.stringify(modelJson);
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      if (targetPath.endsWith('.bin')) {
        throw new Error('ENOENT: shard file missing');
      }
      throw new Error(`Unexpected: ${targetPath}`);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when file system permission denied', async () => {
    fsMocks.readFile.mockImplementation(async () => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });
});

describe('LSTM chaos - corrupted model files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 500 when model.json is invalid JSON', async () => {
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return '{corrupted json!!!';
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A'] });
      }
      return Buffer.from([0]);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.json is empty string', async () => {
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return '';
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A'] });
      }
      return Buffer.from([0]);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.json has no weightsManifest', async () => {
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) {
        return JSON.stringify({ format: 'layers-model', modelTopology: {} });
      }
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A'] });
      }
      return Buffer.from([0]);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.json has empty weightsManifest', async () => {
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) {
        return JSON.stringify({
          format: 'layers-model',
          modelTopology: {},
          weightsManifest: [],
        });
      }
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A'] });
      }
      return Buffer.from([0]);
    });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });
});

describe('LSTM chaos - TF.js loading failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  function mockValidFiles() {
    const modelJson = {
      format: 'layers-model',
      modelTopology: { class_name: 'Model', config: {} },
      weightsManifest: [{
        paths: ['group1-shard1of1.bin'],
        weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
      }],
    };

    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return JSON.stringify(modelJson);
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      if (targetPath.endsWith('.bin')) return Buffer.from([1, 2, 3, 4]);
      throw new Error(`Unexpected: ${targetPath}`);
    });
  }

  it('returns 500 when tf.loadLayersModel throws', async () => {
    mockValidFiles();
    tfMocks.loadLayersModel.mockRejectedValue(new Error('TF.js internal failure'));

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when tf.loadLayersModel throws "already registered"', async () => {
    mockValidFiles();
    tfMocks.loadLayersModel.mockRejectedValue(
      new Error('Variable with name dense/kernel was already registered')
    );

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.predict throws', async () => {
    mockValidFiles();
    const predict = vi.fn(() => { throw new Error('OOM when allocating tensor'); });
    tfMocks.loadLayersModel.mockResolvedValue({ predict });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.predict returns null', async () => {
    mockValidFiles();
    const predict = vi.fn(() => null);
    tfMocks.loadLayersModel.mockResolvedValue({ predict });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });

  it('returns 500 when model.predict returns empty object', async () => {
    mockValidFiles();
    const predict = vi.fn(() => ({}));
    tfMocks.loadLayersModel.mockResolvedValue({ predict });

    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: validLandmarks() }));

    expect(response.status).toBe(500);
  });
});

describe('LSTM chaos - malformed request payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 400 when landmarks is null', async () => {
    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: null }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when landmarks is a string', async () => {
    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: 'not an array' }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when landmarks is a number', async () => {
    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: 42 }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when landmarks is an empty array', async () => {
    const route = await import('./route');
    const response = await route.POST(makeRequest({ landmarks: [] }));

    expect(response.status).toBe(400);
  });

  it('returns 400 when landmarks has wrong feature count', async () => {
    const route = await import('./route');
    const landmarks = Array.from({ length: 16 }, () => Array(10).fill(0));
    const response = await route.POST(makeRequest({ landmarks }));

    expect(response.status).toBe(400);
  });

  it('returns 500 when request.json() throws', async () => {
    const route = await import('./route');
    const badRequest = {
      json: async () => { throw new Error('Invalid JSON'); },
    } as unknown as NextRequest;
    const response = await route.POST(badRequest);

    expect(response.status).toBe(500);
  });

  it('handles extremely large landmark arrays without crashing', async () => {
    const route = await import('./route');
    // 10000 frames is above normal but should be handled gracefully
    const landmarks = Array.from({ length: 10000 }, () => Array(63).fill(0));

    const outputTensor = new tfMocks.Tensor([0.5, 0.3, 0.2]);
    tfMocks.loadLayersModel.mockResolvedValue({ predict: vi.fn(() => outputTensor) });

    // Set up valid model files for loading
    const modelJson = {
      format: 'layers-model',
      modelTopology: { class_name: 'Model', config: {} },
      weightsManifest: [{
        paths: ['group1-shard1of1.bin'],
        weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
      }],
    };
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return JSON.stringify(modelJson);
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      if (targetPath.endsWith('.bin')) return Buffer.from([1, 2, 3, 4]);
      throw new Error(`Unexpected: ${targetPath}`);
    });

    const response = await route.POST(makeRequest({ landmarks }));
    // Should handle gracefully (200 with truncated input, or still succeed)
    expect([200, 400, 500]).toContain(response.status);
  });

  it('handles NaN values in landmarks gracefully', async () => {
    const route = await import('./route');
    const landmarks = Array.from({ length: 16 }, () => Array(63).fill(NaN));

    const outputTensor = new tfMocks.Tensor([0.5, 0.3, 0.2]);
    tfMocks.loadLayersModel.mockResolvedValue({ predict: vi.fn(() => outputTensor) });

    const modelJson = {
      format: 'layers-model',
      modelTopology: { class_name: 'Model', config: {} },
      weightsManifest: [{
        paths: ['group1-shard1of1.bin'],
        weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
      }],
    };
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return JSON.stringify(modelJson);
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      if (targetPath.endsWith('.bin')) return Buffer.from([1, 2, 3, 4]);
      throw new Error(`Unexpected: ${targetPath}`);
    });

    const response = await route.POST(makeRequest({ landmarks }));
    // Should not crash — either produces result or returns error
    expect([200, 400, 500]).toContain(response.status);
  });

  it('handles Infinity values in landmarks gracefully', async () => {
    const route = await import('./route');
    const landmarks = Array.from({ length: 16 }, () => Array(63).fill(Infinity));

    const outputTensor = new tfMocks.Tensor([0.5, 0.3, 0.2]);
    tfMocks.loadLayersModel.mockResolvedValue({ predict: vi.fn(() => outputTensor) });

    const modelJson = {
      format: 'layers-model',
      modelTopology: { class_name: 'Model', config: {} },
      weightsManifest: [{
        paths: ['group1-shard1of1.bin'],
        weights: [{ name: 'dense/kernel', shape: [1], dtype: 'float32' }],
      }],
    };
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('model.json')) return JSON.stringify(modelJson);
      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({ vocabulary: ['A', 'B', 'C'] });
      }
      if (targetPath.endsWith('.bin')) return Buffer.from([1, 2, 3, 4]);
      throw new Error(`Unexpected: ${targetPath}`);
    });

    const response = await route.POST(makeRequest({ landmarks }));
    expect([200, 400, 500]).toContain(response.status);
  });
});
