// Public-domain algorithms by David Blackman and Sebastiano Vigna.
// https://prng.di.unimi.it/xoshiro128starstar.c
// https://prng.di.unimi.it/splitmix64.c
// Replications use the published 2^64-step jump rather than adjacent seeds.
export function randomFor(seed: number, stream = 0): () => number {
  if (
    !Number.isSafeInteger(seed) ||
    !Number.isInteger(stream) ||
    stream < 0 ||
    stream > 50
  )
    throw new Error(
      'Random seed must be a safe integer and stream must be between 0 and 50.',
    );
  const mask = (1n << 64n) - 1n;
  let mixer = BigInt(seed) & mask;
  const state = new Uint32Array(4);
  for (let i = 0; i < 4; i++) {
    mixer = (mixer + 0x9e3779b97f4a7c15n) & mask;
    let z = mixer;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    z ^= z >> 31n;
    state[i] = Number(z & 0xffffffffn);
  }
  if (state.every((word) => word === 0)) state[0] = 1;
  const rotate = (value: number, count: number) =>
    ((value << count) | (value >>> (32 - count))) >>> 0;
  const next = () => {
    const result = Math.imul(rotate(Math.imul(state[1]!, 5), 7), 9) >>> 0;
    const shifted = state[1]! << 9;
    state[2] = state[2]! ^ state[0]!;
    state[3] = state[3]! ^ state[1]!;
    state[1] = state[1]! ^ state[2]!;
    state[0] = state[0]! ^ state[3]!;
    state[2] = state[2]! ^ shifted;
    state[3] = rotate(state[3]!, 11);
    return result;
  };
  for (let replication = 0; replication < stream; replication++) {
    const jumped = new Uint32Array(4);
    for (const polynomial of [0x8764000b, 0xf542d2d3, 0x6fa035c3, 0x77f2db5b])
      for (let bit = 0; bit < 32; bit++) {
        if (polynomial & (1 << bit))
          for (let i = 0; i < 4; i++) jumped[i] = jumped[i]! ^ state[i]!;
        next();
      }
    state.set(jumped);
  }
  return () => (next() + 0.5) / 4294967296;
}
