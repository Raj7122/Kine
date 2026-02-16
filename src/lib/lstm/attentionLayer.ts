/**
 * Custom AttentionLayer for TF.js
 *
 * Mirrors the Python AttentionLayer from scripts/lstm_training/model.py.
 * Must be registered via tf.serialization.registerClass before loading
 * any model that uses this layer (Keras 3 export).
 *
 * Attention mechanism: tanh(input @ W + b) @ u → softmax → weighted sum
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFModule = any;

let registered = false;

export function registerAttentionLayer(tf: TFModule): void {
  if (registered) return;

  const LayerBase = tf.layers.Layer;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  class AttentionLayer extends (LayerBase as any) {
    private units: number;
    private W: unknown;
    private b: unknown;
    private u: unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(config: any) {
      super(config);
      this.units = config.units || 64;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    build(inputShape: any): void {
      const shape = Array.isArray(inputShape[0]) ? inputShape[0] : inputShape;
      const featureDim = shape[shape.length - 1];
      this.W = this.addWeight('attention_weight', [featureDim, this.units], 'float32', tf.initializers.glorotUniform({}));
      this.b = this.addWeight('attention_bias', [this.units], 'float32', tf.initializers.zeros());
      this.u = this.addWeight('attention_context', [this.units], 'float32', tf.initializers.glorotUniform({}));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call(inputs: any): any {
      return tf.tidy(() => {
        const input = Array.isArray(inputs) ? inputs[0] : inputs;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const W = (this.W as any).read();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = (this.b as any).read();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = (this.u as any).read();
        const projected = tf.add(tf.dot(input, W), b);
        const uIt = tf.tanh(projected);
        const aIt = tf.dot(uIt, u);
        const alpha = tf.softmax(aIt, -1);
        const expanded = tf.expandDims(alpha, -1);
        return tf.sum(tf.mul(input, expanded), 1);
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeOutputShape(inputShape: any): any {
      const shape = Array.isArray(inputShape[0]) ? inputShape[0] : inputShape;
      return [shape[0], shape[shape.length - 1]];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getConfig(): any {
      const base = super.getConfig();
      return { ...base, units: this.units };
    }

    static get className(): string {
      return 'AttentionLayer';
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tf.serialization.registerClass(AttentionLayer as any);
  registered = true;
}

/** Reset registration state (for tests that reset modules). */
export function resetAttentionLayerRegistration(): void {
  registered = false;
}
