import { describe, expect, it } from 'vitest';

import { createApplicationInfo } from '../src/index.js';

describe('createApplicationInfo', () => {
  it('returns the fixed application metadata', () => {
    expect(createApplicationInfo()).toEqual({
      name: 'output-pulse',
      runtime: 'node',
    });
  });
});
