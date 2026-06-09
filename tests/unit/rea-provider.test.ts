// tests/unit/rea-provider.test.ts
import { ProviderSchema } from '@/schemas/sources';
import { describe, expect, it } from 'vitest';

describe('ProviderSchema', () => {
  it('accepts the REA providers', () => {
    expect(ProviderSchema.parse('rea')).toBe('rea');
    expect(ProviderSchema.parse('rea+nsw-vg')).toBe('rea+nsw-vg');
  });

  it('no longer accepts the retired Domain providers', () => {
    expect(ProviderSchema.safeParse('domain').success).toBe(false);
    expect(ProviderSchema.safeParse('domain+nsw-vg').success).toBe(false);
  });
});
