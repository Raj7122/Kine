import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function mockModelFiles() {
  const modelJson = {
    format: 'layers-model',
    modelTopology: { class_name: 'Model', config: {} },
    weightsManifest: [
      {
        paths: ['group1-shard1of1.bin'],
        weights: [
          {
            name: 'dense/kernel',
            shape: [1],
            dtype: 'float32',
          },
        ],
      },
    ],
  };

  fsMocks.readFile.mockImplementation(async (targetPath: string) => {
    if (targetPath.endsWith('model.json')) {
      return JSON.stringify(modelJson);
    }

    if (targetPath.endsWith('metadata.json')) {
      return JSON.stringify({ vocabulary: ['HELLO', 'PLEASE', 'THANK_YOU'] });
    }

    if (targetPath.endsWith('.bin')) {
      return Buffer.from([1, 2, 3, 4]);
    }

    throw new Error(`Unexpected readFile path: ${targetPath}`);
  });
}

function makeRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/lstm/predict route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockModelFiles();
  });

  it('returns 400 when landmarks are missing', async () => {
    const route = await import('./route');

    const response = await route.POST(makeRequest({}));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('landmarks array required');
  });

  it('returns 400 for invalid feature length', async () => {
    const route = await import('./route');

    const response = await route.POST(makeRequest({ landmarks: [[1, 2, 3]] }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Invalid feature count');
  });

  it('runs layers-model inference and returns top3 predictions', async () => {
    const outputTensor = new tfMocks.Tensor([0.05, 0.9, 0.05]);
    const predict = vi.fn(() => outputTensor);
    tfMocks.loadLayersModel.mockResolvedValue({ predict });

    const route = await import('./route');

    const landmarks = Array.from({ length: 16 }, () => Array(63).fill(0.1));
    const response = await route.POST(makeRequest({ landmarks }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sign).toBe('PLEASE');
    expect(payload.confidence).toBeCloseTo(0.9, 5);
    expect(payload.top3).toHaveLength(3);
    expect(payload.top3[0].sign).toBe('PLEASE');
    expect(tfMocks.tensor3d).toHaveBeenCalled();
    expect(tfMocks.loadLayersModel).toHaveBeenCalledTimes(1);
  });

  it('accepts 126-feature frames by extracting dominant hand', async () => {
    const outputTensor = new tfMocks.Tensor([0.6, 0.2, 0.2]);
    const predict = vi.fn(() => outputTensor);
    tfMocks.loadLayersModel.mockResolvedValue({ predict });

    const route = await import('./route');

    const frame126 = Array(126).fill(0);
    frame126[63] = 0.4;
    frame126[64] = 0.5;
    frame126[65] = 0.1;

    const landmarks = Array.from({ length: 16 }, () => [...frame126]);
    const response = await route.POST(makeRequest({ landmarks }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sign).toBe('HELLO');
    expect(payload.top3).toHaveLength(3);
  });
});
