// SPDX-License-Identifier: Apache-2.0
import { cleanEnv, str, bool } from 'envalid';
import { config as dotenvConfig } from 'dotenv';

// Load .env if present
if (process.env.NODE_ENV !== 'production') {
  dotenvConfig();
}

export const getEnv = () => {
  return cleanEnv(process.env, {
    OTLP_ENDPOINT: str({ default: '' }),
    TRACE_SAMPLE_RATE: str({ default: '0.0' }),
    NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  });
};