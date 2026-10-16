"""xoshiro128** and SplitMix64, matching the offline engine bit for bit.

Public-domain algorithms by David Blackman and Sebastiano Vigna.
"""

MASK32, MASK64 = (1 << 32) - 1, (1 << 64) - 1


def random_for(seed, stream=0):
    if (
        type(seed) is not int
        or abs(seed) > 9007199254740991
        or type(stream) is not int
        or not 0 <= stream <= 50
    ):
        raise ValueError('Random seed must be a safe integer and stream must be between 0 and 50.')
    mixer, state = seed & MASK64, []
    for _ in range(4):
        mixer = (mixer + 0x9E3779B97F4A7C15) & MASK64
        z = mixer
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK64
        state.append((z ^ (z >> 31)) & MASK32)
    if not any(state):
        state[0] = 1

    def rotate(value, count):
        return ((value << count) | (value >> (32 - count))) & MASK32

    def next_():
        result = (rotate((state[1] * 5) & MASK32, 7) * 9) & MASK32
        shifted = (state[1] << 9) & MASK32
        state[2] ^= state[0]
        state[3] ^= state[1]
        state[1] ^= state[2]
        state[0] ^= state[3]
        state[2] ^= shifted
        state[3] = rotate(state[3], 11)
        return result

    for _ in range(stream):
        jumped = [0] * 4
        for polynomial in (0x8764000B, 0xF542D2D3, 0x6FA035C3, 0x77F2DB5B):
            for bit in range(32):
                if polynomial & (1 << bit):
                    for i in range(4):
                        jumped[i] ^= state[i]
                next_()
        state[:] = jumped
    return lambda: (next_() + 0.5) / 4294967296
