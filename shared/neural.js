// ═══════════════════════════════════════════════════════════════════════════
//  NEURAL NETWORK - Lightweight feedforward net for neuroevolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Feedforward neural network with tanh hidden activations and sigmoid output.
 * Designed for neuroevolution: mutation, crossover, and JSON serialization.
 */
export class NeuralNet {
  /**
   * @param {number[]} layers - Layer sizes, e.g. [45, 32, 16, 13]
   */
  constructor(layers) {
    this.layers = [...layers];
    this.weights = [];
    this.biases = [];

    for (let i = 0; i < layers.length - 1; i++) {
      const fanIn = layers[i];
      const fanOut = layers[i + 1];
      const scale = Math.sqrt(6 / (fanIn + fanOut));
      const w = new Float64Array(fanIn * fanOut);
      const b = new Float64Array(fanOut);
      for (let j = 0; j < w.length; j++) {
        w[j] = (Math.random() * 2 - 1) * scale;
      }
      this.weights.push(w);
      this.biases.push(b);
    }
  }

  /**
   * Forward pass through the network.
   * @param {number[]|Float64Array} input - Input vector of length layers[0]
   * @returns {number[]} Output vector of length layers[last]
   */
  forward(input) {
    let prev = input;
    const lastIdx = this.weights.length - 1;

    for (let i = 0; i <= lastIdx; i++) {
      const inSize = this.layers[i];
      const outSize = this.layers[i + 1];
      const w = this.weights[i];
      const b = this.biases[i];
      const out = new Float64Array(outSize);

      for (let k = 0; k < outSize; k++) {
        let sum = b[k];
        for (let j = 0; j < inSize; j++) {
          sum += prev[j] * w[j * outSize + k];
        }
        // Hidden layers: tanh, output layer: sigmoid
        out[k] = i < lastIdx
          ? Math.tanh(sum)
          : 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, sum))));
      }
      prev = out;
    }

    return Array.from(prev);
  }

  /**
   * Serialize to a plain JSON-safe object.
   * @returns {{ layers: number[], weights: number[][], biases: number[][] }}
   */
  toJSON() {
    return {
      layers: [...this.layers],
      weights: this.weights.map(w => Array.from(w)),
      biases: this.biases.map(b => Array.from(b)),
    };
  }

  /**
   * Reconstruct a NeuralNet from a JSON object.
   * @param {{ layers: number[], weights: number[][], biases: number[][] }} json
   * @returns {NeuralNet}
   */
  static fromJSON(json) {
    const net = Object.create(NeuralNet.prototype);
    net.layers = [...json.layers];
    net.weights = json.weights.map(w => new Float64Array(w));
    net.biases = json.biases.map(b => new Float64Array(b));
    return net;
  }

  /**
   * Clone this network.
   * @returns {NeuralNet}
   */
  clone() {
    return NeuralNet.fromJSON(this.toJSON());
  }

  /**
   * Mutate weights and biases in-place.
   * @param {number} [rate=0.1] - Probability of mutating each weight
   * @param {number} [strength=0.3] - Max magnitude of mutation
   */
  mutate(rate = 0.1, strength = 0.3) {
    for (let i = 0; i < this.weights.length; i++) {
      const w = this.weights[i];
      const b = this.biases[i];
      for (let j = 0; j < w.length; j++) {
        if (Math.random() < rate) {
          w[j] += (Math.random() * 2 - 1) * strength;
        }
      }
      for (let j = 0; j < b.length; j++) {
        if (Math.random() < rate) {
          b[j] += (Math.random() * 2 - 1) * strength;
        }
      }
    }
    return this;
  }

  /**
   * Uniform crossover with another net. Returns a new child net.
   * @param {NeuralNet} other
   * @returns {NeuralNet}
   */
  crossover(other) {
    const child = this.clone();
    for (let i = 0; i < child.weights.length; i++) {
      const w = child.weights[i];
      const ow = other.weights[i];
      for (let j = 0; j < w.length; j++) {
        if (Math.random() < 0.5) w[j] = ow[j];
      }
      const b = child.biases[i];
      const ob = other.biases[i];
      for (let j = 0; j < b.length; j++) {
        if (Math.random() < 0.5) b[j] = ob[j];
      }
    }
    return child;
  }

  /**
   * Count total trainable parameters.
   * @returns {number}
   */
  paramCount() {
    let n = 0;
    for (let i = 0; i < this.weights.length; i++) {
      n += this.weights[i].length + this.biases[i].length;
    }
    return n;
  }
}
