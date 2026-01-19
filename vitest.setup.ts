import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock HTMLCanvasElement.getContext for canvas operations in tests
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: '',
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock canvas toDataURL
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,mockBase64Image');
